import io
import threading

import numpy as np
import sounddevice as sd
import soundfile as sf

from .config import CHANNELS, SAMPLE_RATE
from .logger import get as get_logger

_log = get_logger("audio_recorder")


class AudioRecorder:
    def __init__(self):
        self._buffer = []
        self._stream = None
        self._recording = False
        self._device_id = None
        self._current_level = 0.0
        self._level_lock = threading.Lock()
        self._buffer_lock = threading.Lock()

    def _callback(self, indata, frames, time, status):
        if self._recording:
            with self._buffer_lock:
                self._buffer.append(indata.copy())
        rms = float(np.sqrt(np.mean(indata**2)))
        normalized = min(1.0, rms * 3.0)
        with self._level_lock:
            self._current_level = normalized

    def start(self):
        self._buffer = []
        self._recording = True
        kwargs = {
            "samplerate": SAMPLE_RATE,
            "channels": CHANNELS,
            "dtype": "float32",
            "callback": self._callback,
        }
        if self._device_id is not None:
            kwargs["device"] = self._device_id
        try:
            self._stream = sd.InputStream(**kwargs)
            self._stream.start()
        except Exception:
            if self._stream is not None:
                try:
                    self._stream.close()
                except Exception:
                    _log.debug("Stream close during error recovery failed", exc_info=True)
            self._stream = None
            self._recording = False
            raise

    def stop(self):
        self._recording = False
        if self._stream:
            self._stream.stop()
            self._stream.close()
            self._stream = None
        with self._level_lock:
            self._current_level = 0.0

    def is_recording(self):
        return self._recording

    def get_level(self):
        with self._level_lock:
            return self._current_level

    def set_device(self, device_id):
        self._device_id = device_id
        if self._recording:
            self.stop()
            self.start()

    @classmethod
    def list_devices(cls):
        devices = sd.query_devices()
        input_devices = []
        seen_names = set()
        _exclude = ["mapper", "stereo mix", "wave out", "loopback", "virtual", "cable"]

        for i, dev in enumerate(devices):
            if dev["max_input_channels"] < 1:
                continue
            name = dev["name"].strip()
            if any(kw in name.lower() for kw in _exclude):
                continue
            if name in seen_names:
                continue
            seen_names.add(name)
            input_devices.append({"id": i, "name": name})

        return input_devices

    def get_audio_numpy(self):
        with self._buffer_lock:
            if not self._buffer:
                return None
            audio = np.concatenate(self._buffer, axis=0)
        if audio.ndim > 1:
            audio = audio.squeeze()
        return audio

    def get_wav_bytes(self):
        with self._buffer_lock:
            if not self._buffer:
                return None
            audio_data = np.concatenate(self._buffer, axis=0)
        buf = io.BytesIO()
        sf.write(buf, audio_data, SAMPLE_RATE, format="WAV", subtype="PCM_16")
        buf.seek(0)
        return buf

    def get_duration(self):
        with self._buffer_lock:
            if not self._buffer:
                return 0.0
            total_samples = sum(chunk.shape[0] for chunk in self._buffer)
        return total_samples / SAMPLE_RATE
