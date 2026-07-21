"""
WhisperClick sound design — Intimate Piano.

Octave-doubled felt piano with wooden transients. All tones are pre-rendered
at module load for instant playback (no synthesis delay on trigger).
"""

import atexit
import threading
import time

import numpy as np
import sounddevice as sd

SR = 44100
_play_lock = threading.Lock()
_enabled = True


def set_enabled(enabled):
    global _enabled
    _enabled = enabled


def _cleanup_audio():
    sd.stop()
    _play_lock.acquire(timeout=2)
    try:
        pass
    finally:
        try:
            _play_lock.release()
        except RuntimeError:
            pass
    time.sleep(0.05)


atexit.register(_cleanup_audio)


def _adsr(n, attack_ms=6, decay_ms=60, sustain_level=0.7, release_ms=120):
    a = int(SR * attack_ms / 1000)
    d = int(SR * decay_ms / 1000)
    r = int(SR * release_ms / 1000)
    s = max(0, n - a - d - r)

    parts = []
    if a > 0:
        parts.append(np.linspace(0, 1.0, a))
    if d > 0:
        parts.append(np.linspace(1.0, sustain_level, d))
    if s > 0:
        parts.append(np.full(s, sustain_level))
    if r > 0:
        parts.append(np.linspace(sustain_level, 0, r))

    env = np.concatenate(parts) if parts else np.zeros(1)
    if len(env) < n:
        env = np.pad(env, (0, n - len(env)))
    return env[:n].astype(np.float64)


def _wood_transient(duration=0.010, volume=0.15, brightness=0.5):
    n = int(SR * duration)
    noise = np.random.randn(n).astype(np.float64) * volume
    env = np.exp(-np.linspace(0, 10, n))
    kernel_size = max(2, int(12 * (1.0 - brightness)))
    kernel = np.ones(kernel_size) / kernel_size
    filtered = np.convolve(noise * env, kernel, mode="same")
    body_freq = 120 + brightness * 80
    body = np.sin(2 * np.pi * body_freq * np.linspace(0, duration, n, False))
    body *= np.exp(-np.linspace(0, 15, n)) * volume * 0.3
    return (filtered + body).astype(np.float32)


def _felt_piano(
    freq,
    duration,
    volume=0.3,
    attack_ms=8,
    decay_ms=80,
    sustain_level=0.55,
    release_ms=150,
    vibrato_hz=0,
    vibrato_depth=0,
    damping=1.0,
):
    n = int(SR * duration)
    t = np.linspace(0, duration, n, False)
    B = 0.0004

    partials = [
        (1, 1.0),
        (2, 0.45),
        (3, 0.18),
        (4, 0.08),
        (5, 0.03),
        (6, 0.01),
    ]

    if vibrato_hz > 0 and vibrato_depth > 0:
        pitch_mod = 1.0 + vibrato_depth * np.sin(2 * np.pi * vibrato_hz * t)
    else:
        pitch_mod = 1.0

    wave1 = np.zeros(n, dtype=np.float64)
    for partial_n, amp in partials:
        f_n = freq * partial_n * np.sqrt(1 + B * partial_n**2)
        partial_decay = np.exp(-t * partial_n * 1.5 / (duration * damping))
        wave1 += amp * np.sin(2 * np.pi * f_n * t * pitch_mod) * partial_decay

    detune = 0.8
    wave2 = np.zeros(n, dtype=np.float64)
    for partial_n, amp in partials:
        f_n = (freq + detune) * partial_n * np.sqrt(1 + B * partial_n**2)
        partial_decay = np.exp(-t * partial_n * 1.5 / (duration * damping))
        wave2 += amp * np.sin(2 * np.pi * f_n * t * pitch_mod) * partial_decay

    combined = wave1 * 0.55 + wave2 * 0.45
    env = _adsr(n, attack_ms, decay_ms, sustain_level, release_ms)
    result = combined * env * volume
    return result.astype(np.float32)


def _sub_bass(freq, duration, volume=0.12, damping=1.0):
    return _felt_piano(
        freq / 4,
        duration * 1.1,
        volume=volume,
        attack_ms=12,
        decay_ms=70,
        sustain_level=0.5,
        release_ms=150,
        damping=damping,
    )


def _deep_bass(freq, duration, volume=0.18):
    n = int(SR * duration)
    t = np.linspace(0, duration, n, False)
    bass_freq = max(freq / 8, 32)
    wave = np.sin(2 * np.pi * bass_freq * t)
    wave += 0.3 * np.sin(2 * np.pi * bass_freq * 2 * t)
    env = _adsr(n, attack_ms=20, decay_ms=80, sustain_level=0.7, release_ms=200)
    return (wave * env * volume).astype(np.float32)


def _octave_note(freq, duration, volume=0.42, **kw):
    low = _felt_piano(freq / 2, duration, volume=volume * 0.45, **kw)
    high = _felt_piano(freq, duration, volume=volume * 0.55, **kw)
    mx = max(len(low), len(high))
    out = np.zeros(mx, dtype=np.float32)
    out[: len(low)] += low
    out[: len(high)] += high
    return out


def _reverb(audio, echoes=4, delay_ms=30, decay=0.3):
    result = audio.copy()
    delay_samples = int(SR * delay_ms / 1000)
    for i in range(1, echoes + 1):
        offset = delay_samples * i
        gain = decay**i
        padded = np.zeros(len(audio) + offset, dtype=np.float32)
        padded[offset : offset + len(audio)] = audio * gain
        if len(result) < len(padded):
            result = np.pad(result, (0, len(padded) - len(result)))
        result[: len(padded)] += padded
    return result


def _mix_layers(*layers):
    max_len = max(len(layer) for layer in layers)
    result = np.zeros(max_len, dtype=np.float32)
    for layer in layers:
        result[: len(layer)] += layer
    return result


def _normalize(audio, peak=0.85):
    mx = np.max(np.abs(audio))
    if mx > 0:
        audio = audio * (peak / mx)
    return audio


def _play(audio):
    if not _enabled:
        return

    def _do_play():
        with _play_lock:
            sd.play(audio, SR, blocking=True)

    threading.Thread(target=_do_play, daemon=True).start()


# Common parameters
_PK = dict(attack_ms=6, decay_ms=55, sustain_level=0.6, release_ms=130, vibrato_hz=3.5, vibrato_depth=0.002)
_PK_LONG = dict(
    attack_ms=6, decay_ms=55, sustain_level=0.6, release_ms=180, vibrato_hz=3.0, vibrato_depth=0.003, damping=1.3
)
_PK_DAMP = dict(attack_ms=5, decay_ms=40, sustain_level=0.4, release_ms=80, damping=0.5)
_PK_ERR = dict(
    attack_ms=8, decay_ms=55, sustain_level=0.45, release_ms=100, vibrato_hz=2.5, vibrato_depth=0.003, damping=0.7
)

_GAP = np.zeros(int(SR * 0.03), dtype=np.float32)
_SGAP = np.zeros(int(SR * 0.025), dtype=np.float32)
_TINY = np.zeros(int(SR * 0.02), dtype=np.float32)


def _render_start():
    click = _wood_transient(0.012, volume=0.15, brightness=0.7)
    n1 = _octave_note(262, 0.28, 0.42, **_PK)
    n2 = _octave_note(392, 0.35, 0.42, **_PK_LONG)
    melody = np.concatenate([click, n1, _GAP, n2])
    sub = _sub_bass(262, 0.65, volume=0.14)
    deep = _deep_bass(262, 0.70, volume=0.20)
    tone = _reverb(_mix_layers(melody, sub, deep), echoes=4, delay_ms=32, decay=0.25)
    return _normalize(tone, 0.80)


def _render_stop():
    click = _wood_transient(0.010, volume=0.12, brightness=0.3)
    note = _octave_note(262, 0.28, 0.38, attack_ms=6, decay_ms=50, sustain_level=0.45, release_ms=100, damping=0.7)
    melody = np.concatenate([click, note])
    sub = _sub_bass(262, 0.35, volume=0.10, damping=0.6)
    deep = _deep_bass(262, 0.38, volume=0.16)
    tone = _reverb(_mix_layers(melody, sub, deep), echoes=3, delay_ms=28, decay=0.20)
    return _normalize(tone, 0.72)


def _render_success():
    click = _wood_transient(0.010, volume=0.12, brightness=0.6)
    n1 = _felt_piano(392, 0.18, volume=0.38, **_PK)
    n2 = _felt_piano(330, 0.18, volume=0.40, **_PK)
    n3 = _octave_note(262, 0.40, 0.42, **_PK_LONG)
    melody = np.concatenate([click, n1, _SGAP, n2, _SGAP, n3])
    bass_offset = len(click) + len(n1) + len(_SGAP) + len(n2) + len(_SGAP)
    sub = _sub_bass(262, 0.50, volume=0.14)
    deep = _deep_bass(262, 0.55, volume=0.20)
    total_len = max(len(melody), bass_offset + max(len(sub), len(deep)))
    mixed = np.zeros(total_len, dtype=np.float32)
    mixed[: len(melody)] += melody
    mixed[bass_offset : bass_offset + len(sub)] += sub
    mixed[bass_offset : bass_offset + len(deep)] += deep
    tone = _reverb(mixed, echoes=5, delay_ms=35, decay=0.28)
    return _normalize(tone, 0.85)


def _render_cancel():
    click = _wood_transient(0.008, volume=0.10, brightness=0.2)
    n1 = _felt_piano(262, 0.18, volume=0.32, **_PK_DAMP)
    n2 = _felt_piano(196, 0.22, volume=0.28, **_PK_DAMP)
    melody = np.concatenate([click, n1, _TINY, n2])
    sub = _sub_bass(196, 0.35, volume=0.08, damping=0.5)
    deep = _deep_bass(196, 0.38, volume=0.12)
    tone = _reverb(_mix_layers(melody, sub, deep), echoes=2, delay_ms=25, decay=0.15)
    return _normalize(tone, 0.55)


def _render_error():
    click = _wood_transient(0.012, volume=0.10, brightness=0.15)
    n1 = _octave_note(220, 0.22, 0.32, **_PK_ERR)
    eg = np.zeros(int(SR * 0.04), dtype=np.float32)
    n2 = _octave_note(208, 0.28, 0.28, **_PK_ERR)
    melody = np.concatenate([click, n1, eg, n2])
    sub = _sub_bass(220, 0.50, volume=0.12, damping=0.6)
    deep = _deep_bass(220, 0.55, volume=0.18)
    tone = _reverb(_mix_layers(melody, sub, deep), echoes=4, delay_ms=42, decay=0.22)
    return _normalize(tone, 0.70)


# Pre-render on import
_TONE_START = _render_start()
_TONE_STOP = _render_stop()
_TONE_SUCCESS = _render_success()
_TONE_CANCEL = _render_cancel()
_TONE_ERROR = _render_error()


def play_start_tone():
    _play(_TONE_START)


def play_stop_tone():
    _play(_TONE_STOP)


def play_success_tone():
    _play(_TONE_SUCCESS)


def play_cancel_tone():
    _play(_TONE_CANCEL)


def play_error_tone():
    _play(_TONE_ERROR)
