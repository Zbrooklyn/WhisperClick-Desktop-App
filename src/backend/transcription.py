import io
import tempfile
import os
import threading

from src.backend.config import OPENAI_API_KEY


class TranscriptionCancelled(Exception):
    """Raised when an in-flight transcription is cancelled."""


class TranscriptionService:
    def __init__(self):
        self.mode = "local"
        self._local_model = None
        self._model_name = "base"
        self._language = None  # None = auto-detect
        self._compute_type = "int8"  # Best for CPU speed
        self._cancel_requested = threading.Event()

    def set_mode(self, mode):
        self.mode = mode

    def set_model(self, model_name):
        if model_name != self._model_name:
            self._model_name = model_name
            self._local_model = None  # force reload

    def set_language(self, language):
        self._language = language if language != "auto" else None

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

            self._local_model = WhisperModel(
                self._model_name,
                device=device,
                compute_type=compute,
            )
        return self._local_model

    def transcribe(self, wav_bytes) -> str:
        if self.mode == "local":
            return self._transcribe_local(wav_bytes)
        else:
            return self._transcribe_api(wav_bytes)

    def _transcribe_local(self, wav_bytes):
        model = self.load_local_model()
        with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as tmp:
            tmp.write(wav_bytes.read())
            tmp_path = tmp.name
        try:
            kwargs = {
                "vad_filter": True,
                "beam_size": 1,
                "condition_on_previous_text": False,
            }
            if self._language:
                kwargs["language"] = self._language
            segments, info = model.transcribe(tmp_path, **kwargs)
            parts = []
            for seg in segments:
                if self.is_cancel_requested():
                    raise TranscriptionCancelled("Transcription cancelled")
                parts.append(seg.text.strip())
            text = " ".join(parts)
            return text.strip()
        finally:
            os.unlink(tmp_path)

    def _transcribe_api(self, wav_bytes):
        if self.is_cancel_requested():
            raise TranscriptionCancelled("Transcription cancelled")
        from openai import OpenAI
        api_key = OPENAI_API_KEY or os.getenv("OPENAI_API_KEY", "")
        if not api_key:
            raise ValueError("OPENAI_API_KEY not set. Add it to your .env file.")
        client = OpenAI(api_key=api_key)
        wav_bytes.name = "audio.wav"
        kwargs = {"model": "whisper-1", "file": wav_bytes}
        if self._language:
            kwargs["language"] = self._language
        response = client.audio.transcriptions.create(**kwargs)
        if self.is_cancel_requested():
            raise TranscriptionCancelled("Transcription cancelled")
        return response.text.strip()
