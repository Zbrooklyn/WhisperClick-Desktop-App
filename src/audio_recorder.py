import io
import numpy as np
import sounddevice as sd
import soundfile as sf
from src.config import SAMPLE_RATE, CHANNELS


class AudioRecorder:
    def __init__(self):
        self._buffer = []
        self._stream = None
        self._recording = False

    def _callback(self, indata, frames, time, status):
        if self._recording:
            self._buffer.append(indata.copy())

    def start(self):
        self._buffer = []
        self._recording = True
        self._stream = sd.InputStream(
            samplerate=SAMPLE_RATE,
            channels=CHANNELS,
            dtype="float32",
            callback=self._callback,
        )
        self._stream.start()

    def stop(self):
        self._recording = False
        if self._stream:
            self._stream.stop()
            self._stream.close()
            self._stream = None

    def is_recording(self):
        return self._recording

    def get_wav_bytes(self):
        if not self._buffer:
            return None
        audio_data = np.concatenate(self._buffer, axis=0)
        buf = io.BytesIO()
        sf.write(buf, audio_data, SAMPLE_RATE, format="WAV", subtype="PCM_16")
        buf.seek(0)
        return buf

    def get_duration(self):
        if not self._buffer:
            return 0.0
        total_samples = sum(chunk.shape[0] for chunk in self._buffer)
        return total_samples / SAMPLE_RATE
