import io
import tempfile
import os
from src.config import TranscriptionMode, OPENAI_API_KEY, WHISPER_MODEL


class TranscriptionService:
    def __init__(self):
        self.mode = TranscriptionMode.LOCAL
        self._local_model = None
        self._model_name = WHISPER_MODEL

    def set_mode(self, mode: TranscriptionMode):
        self.mode = mode

    def set_model(self, model_name: str):
        if model_name != self._model_name:
            self._model_name = model_name
            self._local_model = None  # force reload

    def load_local_model(self):
        if self._local_model is None:
            import whisper
            self._local_model = whisper.load_model(self._model_name)
        return self._local_model

    def transcribe(self, wav_bytes: io.BytesIO) -> str:
        if self.mode == TranscriptionMode.LOCAL:
            return self._transcribe_local(wav_bytes)
        else:
            return self._transcribe_api(wav_bytes)

    def _transcribe_local(self, wav_bytes: io.BytesIO) -> str:
        model = self.load_local_model()
        with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as tmp:
            tmp.write(wav_bytes.read())
            tmp_path = tmp.name
        try:
            result = model.transcribe(tmp_path)
            return result["text"].strip()
        finally:
            os.unlink(tmp_path)

    def _transcribe_api(self, wav_bytes: io.BytesIO) -> str:
        from openai import OpenAI

        if not OPENAI_API_KEY:
            raise ValueError("OPENAI_API_KEY not set. Add it to your .env file.")

        client = OpenAI(api_key=OPENAI_API_KEY)
        wav_bytes.name = "audio.wav"
        response = client.audio.transcriptions.create(
            model="whisper-1",
            file=wav_bytes,
        )
        return response.text.strip()
