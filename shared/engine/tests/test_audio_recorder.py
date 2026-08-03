"""R1 — stale-mic / slow-to-record fix.

Covers the pure device-resolution function and its wiring into
AudioRecorder.start(), proving a stale stored device index can never be
handed to PortAudio (which is what stalls recording for up to a minute).
"""
from unittest import mock

from backend.audio_recorder import AudioRecorder, resolve_input_device

# A realistic device table: one output-only, two real inputs.
DEVICES = [
    {"name": "Speakers (output only)", "max_input_channels": 0},
    {"name": "USB Mic", "max_input_channels": 2},
    {"name": "Webcam Mic", "max_input_channels": 1},
]


# ---- resolve_input_device (pure) ----

def test_none_returns_default():
    assert resolve_input_device(None, DEVICES) is None


def test_valid_input_index_kept():
    assert resolve_input_device(1, DEVICES) == 1


def test_output_only_index_falls_back():
    assert resolve_input_device(0, DEVICES) is None


def test_out_of_range_falls_back():
    assert resolve_input_device(99, DEVICES) is None


def test_negative_falls_back():
    assert resolve_input_device(-1, DEVICES) is None


def test_empty_device_list_falls_back():
    assert resolve_input_device(0, []) is None


def test_non_int_falls_back():
    assert resolve_input_device("1", DEVICES) is None


# ---- start() wiring: a stale id must become the default, never reach PortAudio ----

@mock.patch("backend.audio_recorder.sd")
def test_start_stale_device_uses_default(mock_sd):
    mock_sd.query_devices.return_value = DEVICES
    rec = AudioRecorder()
    rec._device_id = 99  # stale / unplugged → out of range
    rec.start()
    _, kwargs = mock_sd.InputStream.call_args
    assert kwargs.get("device") is None


@mock.patch("backend.audio_recorder.sd")
def test_start_valid_device_passed(mock_sd):
    mock_sd.query_devices.return_value = DEVICES
    rec = AudioRecorder()
    rec._device_id = 1  # valid input → kept
    rec.start()
    _, kwargs = mock_sd.InputStream.call_args
    assert kwargs.get("device") == 1
