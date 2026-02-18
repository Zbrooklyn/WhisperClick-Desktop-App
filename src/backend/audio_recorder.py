import io
import threading

import numpy as np
import sounddevice as sd
import soundfile as sf

from src.backend.config import SAMPLE_RATE, CHANNELS


class AudioRecorder:
    def __init__(self):
        self._buffer = []
        self._stream = None
        self._recording = False
        self._device_id = None
        self._current_level = 0.0
        self._level_lock = threading.Lock()

    def _callback(self, indata, frames, time, status):
        if self._recording:
            self._buffer.append(indata.copy())
        # Always compute the audio level so get_level() works even
        # when the stream is open but not yet recording.
        rms = float(np.sqrt(np.mean(indata ** 2)))
        # Normalize: typical speech RMS on float32 input tops out around
        # 0.3-0.5, so we scale by ~3x and clamp to [0.0, 1.0].
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
        self._stream = sd.InputStream(**kwargs)
        self._stream.start()

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
        """Return current RMS audio level as a float in [0.0, 1.0]."""
        with self._level_lock:
            return self._current_level

    def set_device(self, device_id):
        """Set the input device to use for recording.

        If a recording is currently in progress, it will be restarted
        with the new device.
        """
        self._device_id = device_id
        # If currently recording, restart with the new device
        if self._recording:
            self.stop()
            self.start()

    @classmethod
    def list_devices(cls):
        """Return available audio input devices, filtered for usability."""
        devices = sd.query_devices()
        input_devices = []
        seen_names = set()

        # Keywords indicating virtual/system devices to exclude
        _exclude = ["mapper", "stereo mix", "wave out", "loopback",
                     "virtual", "cable"]

        for i, dev in enumerate(devices):
            if dev["max_input_channels"] < 1:
                continue

            name = dev["name"].strip()

            # Skip virtual / system devices
            if any(kw in name.lower() for kw in _exclude):
                continue

            # Deduplicate by name (keep first occurrence)
            if name in seen_names:
                continue
            seen_names.add(name)

            input_devices.append({"id": i, "name": name})

        return input_devices

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
