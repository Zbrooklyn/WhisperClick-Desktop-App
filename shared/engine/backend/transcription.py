import base64
import io
import json
import math
import os
import tempfile
import threading
from urllib import error as urllib_error
from urllib import request as urllib_request

import soundfile as sf
from openai import APIConnectionError, APITimeoutError, OpenAI

from .api_requests import build_gemini_request, redact_key
from .logger import get as get_logger

_log = get_logger("transcription")


class TranscriptionCancelled(Exception):
    """Raised when an in-flight transcription is cancelled."""


class TranscriptionService:
    def __init__(self):
        self.mode = "local"
        self._local_model = None
        self._model_name = "base"
        self._api_model = "whisper-1"
        self._language = None
        self._compute_type = "int8"
        self._cancel_requested = threading.Event()
        self._api_provider = "openai"
        self._api_key = ""
        self._api_base_url = ""
        self._openai_client = None
        self._openai_client_key = None
        self.detected_language = None
        self._preload_lock = threading.Lock()
        self._preloading = False
        # --- Pro extension points (set by plugins; safe defaults live here so
        # the base engine works unchanged when no plugin is loaded) ---
        self._ext_initial_prompt = None        # vocab/spelling hint reused by every provider
        self._ext_want_word_timestamps = False # ask providers for word timestamps
        self.last_segments = None              # [{speaker,text,start,end}] from the last transcribe
        self.last_words = None                 # [{word,start,end,confidence}] from the last transcribe

    def set_mode(self, mode):
        self.mode = mode
        if mode == "local":
            self._preload_model_async()

    def set_model(self, model_name):
        if model_name != self._model_name:
            self._model_name = model_name
            self._local_model = None
            if self.mode == "local":
                self._preload_model_async()

    def _preload_model_async(self):
        """Load the local model in a background thread so it's ready when needed."""
        target_model = self._model_name  # capture at dispatch time

        def _load():
            self._preloading = True
            try:
                # Abort if user already switched to a different model
                if self._model_name != target_model:
                    _log.info("Skipping stale preload of '%s' (now '%s')", target_model, self._model_name)
                    return
                _log.info("Pre-loading local model '%s' in background...", target_model)
                self.load_local_model()
                _log.info("Local model '%s' ready.", target_model)
            except Exception as exc:
                _log.warning("Background model pre-load failed: %s", exc)
            finally:
                self._preloading = False

        threading.Thread(target=_load, daemon=True).start()

    def set_language(self, language):
        self._language = language if language != "auto" else None

    def set_vocabulary(self, vocabulary):
        """Set a spelling/vocabulary hint applied across every provider.

        Stored on `_ext_initial_prompt`; passed as local `initial_prompt`,
        OpenAI `prompt`, and prepended to the Gemini instruction. Pass a falsy
        value to clear it.
        """
        self._ext_initial_prompt = vocabulary or None

    def set_api_model(self, model_name):
        self._api_model = model_name

    def set_api_credentials(self, provider, api_key, base_url=""):
        self._api_provider = provider or "openai"
        self._api_key = api_key or ""
        self._api_base_url = base_url or ""


    def _get_openai_client(self, api_key, base_url=""):
        cache_key = (api_key, base_url)
        if self._openai_client is None or self._openai_client_key != cache_key:
            client_kwargs = {"api_key": api_key, "timeout": 30.0}
            if base_url:
                client_kwargs["base_url"] = base_url
            self._openai_client = OpenAI(**client_kwargs)
            self._openai_client_key = cache_key
        return self._openai_client

    @staticmethod
    def _compress_audio(wav_bytes):
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
        with self._preload_lock:
            if self._local_model is None:
                from faster_whisper import WhisperModel

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
                    from .models import HF_CACHE_DIR

                    self._local_model = WhisperModel(
                        self._model_name,
                        device=device,
                        compute_type=compute,
                        download_root=HF_CACHE_DIR,
                    )
                except FileNotFoundError:
                    raise ValueError(f"Model '{self._model_name}' not found. Download it from Settings > Models.") from None
                except Exception as exc:
                    raise ValueError(f"Failed to load model '{self._model_name}': {exc}") from exc
            return self._local_model

    def transcribe(self, wav_bytes) -> str:
        # Reset per-call extension outputs so a caller never reads stale
        # segments/words from a previous transcription.
        self.last_segments = None
        self.last_words = None
        if self.mode == "local":
            return self._transcribe_local(wav_bytes)
        else:
            return self._transcribe_api(wav_bytes)

    @staticmethod
    def _logprob_to_confidence(logprob):
        """Map an average log-probability to a 0..1 confidence, or None.

        faster-whisper reports segment quality as `avg_logprob` (<= 0). exp()
        turns that back into a probability we can surface as a confidence score.
        """
        if logprob is None:
            return None
        try:
            return round(math.exp(float(logprob)), 4)
        except (OverflowError, ValueError, TypeError):
            return None

    @staticmethod
    def _seg_attr(obj, name):
        """Read `name` off a segment/word whether it's an object or a dict."""
        if isinstance(obj, dict):
            return obj.get(name)
        return getattr(obj, name, None)

    @classmethod
    def _collect_segments(cls, raw):
        """Normalize an API/local segment list to [{speaker,text,start,end}]."""
        if not raw:
            return None
        out = []
        for s in raw:
            out.append({
                "speaker": cls._seg_attr(s, "speaker"),
                "text": (cls._seg_attr(s, "text") or "").strip(),
                "start": cls._seg_attr(s, "start"),
                "end": cls._seg_attr(s, "end"),
            })
        return out or None

    @classmethod
    def _collect_words(cls, raw):
        """Normalize an API/local word list to [{word,start,end,confidence}].

        `confidence` is a 0..1 float when the provider exposes a per-word score
        (OpenAI verbose word objects carry none today, so it is None there); it
        rides `probability` when the provider names it that instead.
        """
        if not raw:
            return None
        out = []
        for w in raw:
            conf = cls._seg_attr(w, "confidence")
            if conf is None:
                conf = cls._seg_attr(w, "probability")
            out.append({
                "word": cls._seg_attr(w, "word") or "",
                "start": cls._seg_attr(w, "start"),
                "end": cls._seg_attr(w, "end"),
                "confidence": conf,
            })
        return out or None

    def _transcribe_local(self, audio):
        import numpy as np

        model = self.load_local_model()

        if isinstance(audio, np.ndarray):
            audio_input = audio
        else:
            with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as tmp:
                tmp.write(audio.read())
                audio_input = tmp.name

        try:
            kwargs = {
                "vad_filter": True,
                "beam_size": 1,
                "condition_on_previous_text": False,
            }
            if self._ext_initial_prompt:
                kwargs["initial_prompt"] = self._ext_initial_prompt
            want_words = self._ext_want_word_timestamps
            if want_words:
                kwargs["word_timestamps"] = True
            if self._language:
                kwargs["language"] = self._language
            segments, info = model.transcribe(audio_input, **kwargs)
            self.detected_language = getattr(info, "language", None)
            parts = []
            seg_list = []
            word_list = []
            for seg in segments:
                if self.is_cancel_requested():
                    raise TranscriptionCancelled("Transcription cancelled")
                parts.append(seg.text.strip())
                seg_list.append({
                    "speaker": None,
                    "text": (seg.text or "").strip(),
                    "start": getattr(seg, "start", None),
                    "end": getattr(seg, "end", None),
                })
                if want_words:
                    # Segment-level confidence (exp of avg_logprob) is the
                    # fallback for any word faster-whisper doesn't score itself.
                    seg_conf = self._logprob_to_confidence(getattr(seg, "avg_logprob", None))
                    for w in (getattr(seg, "words", None) or []):
                        wp = getattr(w, "probability", None)
                        word_list.append({
                            "word": getattr(w, "word", "") or "",
                            "start": getattr(w, "start", None),
                            "end": getattr(w, "end", None),
                            "confidence": round(float(wp), 4) if wp is not None else seg_conf,
                        })
            self.last_segments = seg_list or None
            self.last_words = word_list or None
            text = " ".join(parts)
            return text.strip()
        finally:
            if isinstance(audio_input, str):
                try:
                    os.unlink(audio_input)
                except FileNotFoundError:
                    pass

    def _transcribe_api(self, wav_bytes):
        if self.is_cancel_requested():
            raise TranscriptionCancelled("Transcription cancelled")

        self.detected_language = None
        provider = self._api_provider or "openai"


        api_key = self._api_key or os.getenv("OPENAI_API_KEY", "")
        if provider == "gemini":
            return self._transcribe_gemini(wav_bytes, api_key)
        else:
            return self._transcribe_openai(wav_bytes, api_key)

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
        use_verbose = model.startswith("whisper")
        call_kwargs = {
            "model": model,
            "file": audio_file,
        }
        if use_verbose:
            call_kwargs["response_format"] = "verbose_json"
            # Word timestamps are only available on the verbose Whisper path and
            # only when the caller (a plugin) asked for them.
            if self._ext_want_word_timestamps:
                call_kwargs["timestamp_granularities"] = ["word"]
        if self._ext_initial_prompt:
            call_kwargs["prompt"] = self._ext_initial_prompt
        if self._language:
            call_kwargs["language"] = self._language
        try:
            response = client.audio.transcriptions.create(**call_kwargs)
        except (APIConnectionError, APITimeoutError):
            raise ValueError("Network error contacting OpenAI. Check your internet connection.") from None
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
        lang_name = getattr(response, "language", None) or ""
        if lang_name:
            self.detected_language = self._LANG_NAME_TO_CODE.get(lang_name.lower(), lang_name.lower()[:2] or None)
        # Surface speaker/timeline segments and word timestamps when the verbose
        # response carried them (they were discarded before).
        self.last_segments = self._collect_segments(getattr(response, "segments", None))
        self.last_words = self._collect_words(getattr(response, "words", None))
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
            f"The spoken language is {self._language}." if self._language else "Detect the spoken language automatically."
        )
        prompt_prefix = f"{self._ext_initial_prompt} " if self._ext_initial_prompt else ""
        request_body = {
            "contents": [
                {
                    "parts": [
                        {"text": f"{prompt_prefix}{lang_instruction} Transcribe this audio accurately. Return only plain transcript text."},
                        {"inline_data": {"mime_type": mime_type, "data": b64_audio}},
                    ]
                }
            ],
            "generationConfig": {"temperature": 0},
        }

        model = self._api_model if self._api_model else "gemini-2.0-flash"
        base_url = self._api_base_url or "https://generativelanguage.googleapis.com/v1beta"

        body_bytes = json.dumps(request_body).encode("utf-8")
        req = build_gemini_request(base_url, model, api_key, body_bytes)

        try:
            with urllib_request.urlopen(req, timeout=30) as response:
                payload = json.loads(response.read().decode("utf-8"))
        except urllib_error.HTTPError as exc:
            code = exc.code
            error_body = exc.read().decode("utf-8", errors="replace")
            safe_body = redact_key(error_body, api_key, limit=300)
            if code in (401, 403):
                raise ValueError("Gemini API key is invalid or expired. Re-verify in Settings > API Keys.") from None
            if code == 429:
                raise ValueError("Gemini rate limit reached. Wait a moment and try again.") from None
            raise ValueError(f"Gemini API error ({code}): {safe_body}") from None
        except urllib_error.URLError:
            raise ValueError("Network error contacting Gemini. Check your internet connection.") from None

        if self.is_cancel_requested():
            raise TranscriptionCancelled("Transcription cancelled")

        try:
            text = payload["candidates"][0]["content"]["parts"][0]["text"]
        except (KeyError, IndexError):
            raise ValueError("Gemini returned an unexpected response format.") from None

        return text.strip()


    # ------------------------------------------------------------------
    # Translation (LLM-based)
    # ------------------------------------------------------------------

    def translate(self, text, target_language, source_language="auto"):
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
        api_key = self._api_key or os.getenv("OPENAI_API_KEY", "")
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
        except (APIConnectionError, APITimeoutError):
            raise ValueError("Network error contacting OpenAI. Check your internet connection.") from None
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

        body_bytes = json.dumps(request_body).encode("utf-8")
        req = build_gemini_request(base_url, model, api_key, body_bytes)

        try:
            with urllib_request.urlopen(req, timeout=30) as response:
                payload = json.loads(response.read().decode("utf-8"))
        except urllib_error.HTTPError as exc:
            code = exc.code
            if code in (401, 403):
                raise ValueError("Gemini API key is invalid or expired. Re-verify in Settings > API Keys.") from None
            if code == 429:
                raise ValueError("Gemini rate limit reached. Wait a moment and try again.") from None
            error_body = exc.read().decode("utf-8", errors="replace")
            safe_body = redact_key(error_body, api_key, limit=300)
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
