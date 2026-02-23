import base64
import io
import json
import os
import tempfile
import threading
from urllib import error as urllib_error
from urllib import request as urllib_request

import soundfile as sf
from openai import OpenAI

from src.backend.config import OPENAI_API_KEY
from src.backend.logger import get as get_logger

_log = get_logger("transcription")


class TranscriptionCancelled(Exception):
    """Raised when an in-flight transcription is cancelled."""


class TranscriptionService:
    def __init__(self):
        self.mode = "local"
        self._local_model = None
        self._model_name = "base"
        self._api_model = "whisper-1"
        self._language = None  # None = auto-detect
        self._compute_type = "int8"  # Best for CPU speed
        self._cancel_requested = threading.Event()
        # Provider config — injected by Api layer before each transcription
        self._api_provider = "openai"
        self._api_key = ""
        self._api_base_url = ""
        # Cached OpenAI client — avoids ~500ms client creation per call
        self._openai_client = None
        self._openai_client_key = None  # (api_key, base_url) tuple for cache invalidation
        # Detected language from last transcription (ISO 639-1 code, e.g. "en")
        self.detected_language = None

    def set_mode(self, mode):
        self.mode = mode

    def set_model(self, model_name):
        if model_name != self._model_name:
            self._model_name = model_name
            self._local_model = None  # force reload

    def set_language(self, language):
        self._language = language if language != "auto" else None

    def set_api_model(self, model_name):
        """Set the model name used for API-mode transcription (e.g. 'whisper-1', 'gemini-2.0-flash')."""
        self._api_model = model_name

    def set_api_credentials(self, provider, api_key, base_url=""):
        """Inject provider credentials before an API-mode transcription."""
        self._api_provider = provider or "openai"
        self._api_key = api_key or ""
        self._api_base_url = base_url or ""

    def _get_openai_client(self, api_key, base_url=""):
        """Return a cached OpenAI client, recreating only when credentials change."""
        cache_key = (api_key, base_url)
        if self._openai_client is None or self._openai_client_key != cache_key:
            client_kwargs = {"api_key": api_key}
            if base_url:
                client_kwargs["base_url"] = base_url
            self._openai_client = OpenAI(**client_kwargs)
            self._openai_client_key = cache_key
        return self._openai_client

    @staticmethod
    def _compress_audio(wav_bytes):
        """Compress WAV to OGG/Opus for faster upload (~10x smaller)."""
        try:
            data, sr = sf.read(wav_bytes, dtype="float32")
            buf = io.BytesIO()
            sf.write(buf, data, sr, format="OGG", subtype="OPUS")
            buf.seek(0)
            buf.name = "audio.ogg"
            return buf
        except Exception:
            _log.warning("Audio compression to OGG failed, falling back to WAV", exc_info=True)
            wav_bytes.seek(0)
            wav_bytes.name = "audio.wav"
            return wav_bytes

    def clear_cancel_request(self):
        self._cancel_requested.clear()

    def request_cancel(self):
        self._cancel_requested.set()

    def is_cancel_requested(self):
        return self._cancel_requested.is_set()

    def load_local_model(self):
        if self._local_model is None:
            from faster_whisper import WhisperModel

            # Auto-detect GPU
            device = "cpu"
            compute = self._compute_type
            try:
                import torch

                if torch.cuda.is_available():
                    device = "cuda"
                    compute = "float16"
            except ImportError:
                pass

            try:
                self._local_model = WhisperModel(
                    self._model_name,
                    device=device,
                    compute_type=compute,
                )
            except FileNotFoundError:
                raise ValueError(f"Model '{self._model_name}' not found. Download it from Settings > Models.") from None
            except Exception as exc:
                raise ValueError(f"Failed to load model '{self._model_name}': {exc}") from exc
        return self._local_model

    def transcribe(self, wav_bytes) -> str:
        if self.mode == "local":
            return self._transcribe_local(wav_bytes)
        else:
            return self._transcribe_api(wav_bytes)

    def _transcribe_local(self, audio):
        """Transcribe using local faster-whisper model.

        Args:
            audio: numpy ndarray (float32) or BytesIO with WAV data.
                   Numpy is preferred — skips WAV encode/decode (~34% faster).
        """
        import numpy as np

        model = self.load_local_model()

        # Accept both numpy arrays (fast path) and BytesIO (fallback)
        if isinstance(audio, np.ndarray):
            audio_input = audio
        else:
            # Legacy BytesIO path — write to temp file
            with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as tmp:
                tmp.write(audio.read())
                audio_input = tmp.name

        try:
            kwargs = {
                "vad_filter": True,
                "beam_size": 1,
                "condition_on_previous_text": False,
            }
            if self._language:
                kwargs["language"] = self._language
            segments, info = model.transcribe(audio_input, **kwargs)
            self.detected_language = getattr(info, "language", None)
            parts = []
            for seg in segments:
                if self.is_cancel_requested():
                    raise TranscriptionCancelled("Transcription cancelled")
                parts.append(seg.text.strip())
            text = " ".join(parts)
            return text.strip()
        finally:
            # Clean up temp file if we used the fallback path
            if isinstance(audio_input, str):
                try:
                    os.unlink(audio_input)
                except FileNotFoundError:
                    pass

    def _transcribe_api(self, wav_bytes):
        if self.is_cancel_requested():
            raise TranscriptionCancelled("Transcription cancelled")

        # Reset — OpenAI sets this via verbose_json, Gemini leaves it for heuristic
        self.detected_language = None

        # Resolve API key: injected credentials > env var > config constant
        api_key = self._api_key or OPENAI_API_KEY or os.getenv("OPENAI_API_KEY", "")
        provider = self._api_provider or "openai"

        if provider == "gemini":
            return self._transcribe_gemini(wav_bytes, api_key)
        else:
            return self._transcribe_openai(wav_bytes, api_key)

    # Map full language names (from Whisper verbose_json) to ISO 639-1 codes
    _LANG_NAME_TO_CODE = {
        "english": "en",
        "spanish": "es",
        "french": "fr",
        "german": "de",
        "japanese": "ja",
        "chinese": "zh",
        "korean": "ko",
        "portuguese": "pt",
        "italian": "it",
        "russian": "ru",
        "arabic": "ar",
        "hindi": "hi",
        "dutch": "nl",
        "polish": "pl",
        "turkish": "tr",
        "swedish": "sv",
        "danish": "da",
        "norwegian": "no",
        "finnish": "fi",
        "greek": "el",
        "czech": "cs",
        "romanian": "ro",
        "hungarian": "hu",
        "thai": "th",
        "vietnamese": "vi",
        "indonesian": "id",
        "malay": "ms",
        "tagalog": "tl",
        "ukrainian": "uk",
        "hebrew": "he",
        "persian": "fa",
        "catalan": "ca",
    }

    def _transcribe_openai(self, wav_bytes, api_key):
        if not api_key:
            raise ValueError("OpenAI API key not set. Add it in Settings > API Keys.")
        client = self._get_openai_client(api_key, self._api_base_url)
        audio_file = self._compress_audio(wav_bytes)
        model = self._api_model if self._api_model else "whisper-1"
        # Only whisper-1 supports verbose_json; gpt-4o-*-transcribe models do not
        use_verbose = model.startswith("whisper")
        call_kwargs = {
            "model": model,
            "file": audio_file,
        }
        if use_verbose:
            call_kwargs["response_format"] = "verbose_json"
        if self._language:
            call_kwargs["language"] = self._language
        try:
            response = client.audio.transcriptions.create(**call_kwargs)
        except Exception as exc:
            msg = str(exc)
            if "401" in msg or "Unauthorized" in msg:
                raise ValueError("OpenAI API key is invalid or expired. Re-verify in Settings > API Keys.") from None
            if "429" in msg or "rate" in msg.lower():
                raise ValueError("OpenAI rate limit reached. Wait a moment and try again.") from None
            if "403" in msg or "Forbidden" in msg:
                raise ValueError("OpenAI access denied. Check your API key permissions.") from None
            raise
        if self.is_cancel_requested():
            raise TranscriptionCancelled("Transcription cancelled")
        # Extract detected language — verbose_json includes it directly,
        # other models may have it as an attribute or leave it for heuristic
        lang_name = getattr(response, "language", None) or ""
        if lang_name:
            self.detected_language = self._LANG_NAME_TO_CODE.get(lang_name.lower(), lang_name.lower()[:2] or None)
        text = getattr(response, "text", None)
        if text is None:
            text = str(response)
        return text.strip()

    def _transcribe_gemini(self, wav_bytes, api_key):
        if not api_key:
            raise ValueError("Gemini API key not set. Add it in Settings > API Keys.")

        audio_file = self._compress_audio(wav_bytes)
        audio_data = audio_file.read()
        mime_type = "audio/ogg" if getattr(audio_file, "name", "").endswith(".ogg") else "audio/wav"
        b64_audio = base64.b64encode(audio_data).decode("utf-8")

        lang_instruction = (
            f"The spoken language is {self._language}."
            if self._language
            else "Detect the spoken language automatically."
        )
        request_body = {
            "contents": [
                {
                    "parts": [
                        {
                            "text": f"{lang_instruction} Transcribe this audio accurately. Return only plain transcript text."
                        },
                        {"inline_data": {"mime_type": mime_type, "data": b64_audio}},
                    ]
                }
            ],
            "generationConfig": {"temperature": 0},
        }

        model = self._api_model if self._api_model else "gemini-2.0-flash"
        base_url = self._api_base_url or "https://generativelanguage.googleapis.com/v1beta"
        url = f"{base_url}/models/{model}:generateContent?key={api_key}"

        body_bytes = json.dumps(request_body).encode("utf-8")
        req = urllib_request.Request(
            url,
            data=body_bytes,
            headers={"Content-Type": "application/json"},
            method="POST",
        )

        try:
            with urllib_request.urlopen(req, timeout=90) as response:
                payload = json.loads(response.read().decode("utf-8"))
        except urllib_error.HTTPError as exc:
            code = exc.code
            error_body = exc.read().decode("utf-8", errors="replace")
            safe_body = error_body[:300].replace(api_key, "***") if api_key else error_body[:300]
            if code in (401, 403):
                raise ValueError("Gemini API key is invalid or expired. Re-verify in Settings > API Keys.") from None
            if code == 429:
                raise ValueError("Gemini rate limit reached. Wait a moment and try again.") from None
            raise ValueError(f"Gemini API error ({code}): {safe_body}") from None
        except urllib_error.URLError:
            raise ValueError("Network error contacting Gemini. Check your internet connection.") from None

        if self.is_cancel_requested():
            raise TranscriptionCancelled("Transcription cancelled")

        # Parse Gemini response
        try:
            text = payload["candidates"][0]["content"]["parts"][0]["text"]
        except (KeyError, IndexError):
            raise ValueError("Gemini returned an unexpected response format.") from None

        return text.strip()

    # ------------------------------------------------------------------
    # Translation (LLM-based)
    # ------------------------------------------------------------------

    def translate(self, text, target_language, source_language="auto"):
        """Translate text using the configured API provider."""
        if not text or not text.strip():
            return ""

        if self.is_cancel_requested():
            raise TranscriptionCancelled("Translation cancelled")

        provider = self._api_provider or "openai"

        if provider == "gemini":
            return self._translate_gemini(text, target_language, source_language)
        else:
            return self._translate_openai(text, target_language, source_language)

    def _translate_openai(self, text, target_language, source_language="auto"):
        api_key = self._api_key or OPENAI_API_KEY or os.getenv("OPENAI_API_KEY", "")
        if not api_key:
            raise ValueError("OpenAI API key not set. Add it in Settings > API Keys.")

        client = self._get_openai_client(api_key, self._api_base_url)

        source_instruction = f" from {source_language}" if source_language and source_language != "auto" else ""
        system_prompt = (
            f"Translate the following text{source_instruction} to {target_language}. "
            "Return only the translated text, with no labels or explanations."
        )

        try:
            response = client.chat.completions.create(
                model="gpt-4o-mini",
                temperature=0,
                messages=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": text},
                ],
            )
        except Exception as exc:
            msg = str(exc)
            if "401" in msg or "Unauthorized" in msg:
                raise ValueError("OpenAI API key is invalid or expired. Re-verify in Settings > API Keys.") from None
            if "429" in msg or "rate" in msg.lower():
                raise ValueError("OpenAI rate limit reached. Wait a moment and try again.") from None
            raise

        if self.is_cancel_requested():
            raise TranscriptionCancelled("Translation cancelled")

        return response.choices[0].message.content.strip()

    def _translate_gemini(self, text, target_language, source_language="auto"):
        api_key = self._api_key or os.getenv("GEMINI_API_KEY", "")
        if not api_key:
            raise ValueError("Gemini API key not set. Add it in Settings > API Keys.")

        source_instruction = f" from {source_language}" if source_language and source_language != "auto" else ""
        prompt = (
            f"Translate the following text{source_instruction} to {target_language}. "
            "Preserve meaning and tone. Return only translated text.\n\n"
            f"{text}"
        )

        request_body = {
            "contents": [{"parts": [{"text": prompt}]}],
            "generationConfig": {"temperature": 0},
        }

        model = self._api_model if self._api_model else "gemini-2.0-flash"
        base_url = self._api_base_url or "https://generativelanguage.googleapis.com/v1beta"
        url = f"{base_url}/models/{model}:generateContent?key={api_key}"

        body_bytes = json.dumps(request_body).encode("utf-8")
        req = urllib_request.Request(
            url,
            data=body_bytes,
            headers={"Content-Type": "application/json"},
            method="POST",
        )

        try:
            with urllib_request.urlopen(req, timeout=60) as response:
                payload = json.loads(response.read().decode("utf-8"))
        except urllib_error.HTTPError as exc:
            code = exc.code
            if code in (401, 403):
                raise ValueError("Gemini API key is invalid or expired. Re-verify in Settings > API Keys.") from None
            if code == 429:
                raise ValueError("Gemini rate limit reached. Wait a moment and try again.") from None
            error_body = exc.read().decode("utf-8", errors="replace")[:300]
            safe_body = error_body.replace(api_key, "***") if api_key else error_body
            raise ValueError(f"Gemini API error ({code}): {safe_body}") from None
        except urllib_error.URLError:
            raise ValueError("Network error contacting Gemini. Check your internet connection.") from None

        if self.is_cancel_requested():
            raise TranscriptionCancelled("Translation cancelled")

        try:
            translated = payload["candidates"][0]["content"]["parts"][0]["text"]
        except (KeyError, IndexError):
            raise ValueError("Gemini returned an unexpected response format.") from None

        return translated.strip()
