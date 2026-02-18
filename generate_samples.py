"""Generate sound recommendation samples as WAV files."""
import sys, os, wave
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import numpy as np
from src.backend.tones import _felt_piano, _wood_transient, _adsr, _reverb, _mix_layers, SR

out_dir = os.path.expanduser("~/Desktop/whisperclick_sounds")
os.makedirs(out_dir, exist_ok=True)

def save_wav(filename, audio):
    path = os.path.join(out_dir, filename)
    peak = np.max(np.abs(audio))
    if peak > 0:
        audio = audio / peak * 0.85
    int16 = (audio * 32767).astype(np.int16)
    with wave.open(path, "w") as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)
        wf.setframerate(SR)
        wf.writeframes(int16.tobytes())
    print(f"  Saved: {filename}", flush=True)

# Helpers
def octave_note(freq, dur, vol=0.42, **kw):
    low = _felt_piano(freq / 2, dur, volume=vol * 0.45, **kw)
    high = _felt_piano(freq, dur, volume=vol * 0.55, **kw)
    return _mix_layers(low, high)

def padded_note(freq, dur, vol=0.42, pad_vol=0.13, pad_attack=180, **kw):
    main = _felt_piano(freq, dur, volume=vol, **kw)
    pad = _felt_piano(freq / 2, dur * 1.3, volume=pad_vol,
                      attack_ms=pad_attack, decay_ms=80, sustain_level=0.5,
                      release_ms=300, vibrato_hz=2.5, vibrato_depth=0.003, damping=1.5)
    return _mix_layers(main, pad)

def piano_chord(freqs, dur, vol=0.42, **kw):
    notes = [_felt_piano(f, dur, volume=vol / len(freqs) * 1.6, **kw) for f in freqs]
    mx = max(len(n) for n in notes)
    out = np.zeros(mx, dtype=np.float32)
    for n in notes:
        out[:len(n)] += n
    return out

one_sec = np.zeros(int(SR * 1.0), dtype=np.float32)
gap = np.zeros(int(SR * 0.03), dtype=np.float32)
sgap = np.zeros(int(SR * 0.025), dtype=np.float32)
tiny = np.zeros(int(SR * 0.02), dtype=np.float32)

# Common parameter sets
pk = dict(attack_ms=6, decay_ms=55, sustain_level=0.6, release_ms=130,
          vibrato_hz=3.5, vibrato_depth=0.002)
pk_long = dict(attack_ms=6, decay_ms=55, sustain_level=0.6, release_ms=180,
               vibrato_hz=3.0, vibrato_depth=0.003, damping=1.3)
pk_damp = dict(attack_ms=5, decay_ms=40, sustain_level=0.4, release_ms=80, damping=0.5)
pk_err = dict(attack_ms=8, decay_ms=55, sustain_level=0.45, release_ms=100,
              vibrato_hz=2.5, vibrato_depth=0.003, damping=0.7)

def build_sequence(tones):
    """Join tones with 1-second gaps."""
    result = tones[0]
    for t in tones[1:]:
        result = np.concatenate([result, one_sec, t])
    return result


# ==================================================================
# REC 1: Intimate Piano (octave-doubled)
# ==================================================================
print("Rec 1: Intimate Piano (octave-doubled)", flush=True)
r1 = []

# Start
click = _wood_transient(0.012, volume=0.15, brightness=0.7)
n1 = octave_note(262, 0.28, 0.42, **pk)
n2 = octave_note(392, 0.35, 0.42, **pk_long)
r1.append(_reverb(np.concatenate([click, n1, gap, n2]), echoes=4, delay_ms=32, decay=0.25))

# Stop
click = _wood_transient(0.010, volume=0.12, brightness=0.4)
n1 = octave_note(392, 0.26, 0.42, **pk)
n2 = octave_note(262, 0.32, 0.42, **pk_long)
r1.append(_reverb(np.concatenate([click, n1, gap, n2]), echoes=4, delay_ms=32, decay=0.25))

# Success
click = _wood_transient(0.010, volume=0.12, brightness=0.6)
n1 = _felt_piano(392, 0.18, volume=0.38, **pk)
n2 = _felt_piano(330, 0.18, volume=0.40, **pk)
n3 = octave_note(262, 0.40, 0.42, **pk_long)
r1.append(_reverb(np.concatenate([click, n1, sgap, n2, sgap, n3]), echoes=5, delay_ms=35, decay=0.28))

# Cancel
click = _wood_transient(0.008, volume=0.10, brightness=0.2)
n1 = _felt_piano(262, 0.18, volume=0.32, **pk_damp)
n2 = _felt_piano(196, 0.22, volume=0.28, **pk_damp)
r1.append(_reverb(np.concatenate([click, n1, tiny, n2]), echoes=2, delay_ms=25, decay=0.15))

# Error
click = _wood_transient(0.012, volume=0.10, brightness=0.15)
n1 = octave_note(220, 0.22, 0.32, **pk_err)
eg = np.zeros(int(SR * 0.04), dtype=np.float32)
n2 = octave_note(208, 0.28, 0.28, **pk_err)
r1.append(_reverb(np.concatenate([click, n1, eg, n2]), echoes=4, delay_ms=42, decay=0.22))

save_wav("REC1_intimate_piano.wav", build_sequence(r1))


# ==================================================================
# REC 2: Piano with Depth (piano + piano pad)
# ==================================================================
print("Rec 2: Piano with Depth (piano + piano pad)", flush=True)
r2 = []

# Start
click = _wood_transient(0.012, volume=0.15, brightness=0.7)
n1 = _felt_piano(262, 0.28, volume=0.42, **pk)
n2 = padded_note(392, 0.38, 0.42, pad_vol=0.14, pad_attack=150, **pk_long)
r2.append(_reverb(np.concatenate([click, n1, gap, n2]), echoes=4, delay_ms=32, decay=0.25))

# Stop
click = _wood_transient(0.010, volume=0.12, brightness=0.4)
n1 = padded_note(392, 0.26, 0.42, pad_vol=0.12, pad_attack=80, **pk)
n2 = _felt_piano(262, 0.32, volume=0.42, **pk_long)
r2.append(_reverb(np.concatenate([click, n1, gap, n2]), echoes=4, delay_ms=32, decay=0.25))

# Success
click = _wood_transient(0.010, volume=0.12, brightness=0.6)
n1 = _felt_piano(392, 0.18, volume=0.38, **pk)
n2 = _felt_piano(330, 0.18, volume=0.40, **pk)
n3 = padded_note(262, 0.45, 0.42, pad_vol=0.15, pad_attack=120, **pk_long)
r2.append(_reverb(np.concatenate([click, n1, sgap, n2, sgap, n3]), echoes=5, delay_ms=35, decay=0.28))

# Cancel
click = _wood_transient(0.008, volume=0.10, brightness=0.2)
n1 = _felt_piano(262, 0.18, volume=0.32, **pk_damp)
n2 = _felt_piano(196, 0.22, volume=0.28, **pk_damp)
r2.append(_reverb(np.concatenate([click, n1, tiny, n2]), echoes=2, delay_ms=25, decay=0.15))

# Error
click = _wood_transient(0.012, volume=0.10, brightness=0.15)
n1 = padded_note(220, 0.22, 0.32, pad_vol=0.10, pad_attack=100, **pk_err)
eg = np.zeros(int(SR * 0.04), dtype=np.float32)
n2 = _felt_piano(208, 0.28, volume=0.28, **pk_err)
r2.append(_reverb(np.concatenate([click, n1, eg, n2]), echoes=4, delay_ms=42, decay=0.22))

save_wav("REC2_piano_with_depth.wav", build_sequence(r2))


# ==================================================================
# REC 3: Rich Chords
# ==================================================================
print("Rec 3: Rich Chords", flush=True)
r3 = []
ck = dict(attack_ms=6, decay_ms=55, sustain_level=0.6, release_ms=150,
          vibrato_hz=3.0, vibrato_depth=0.002)
ck_long = dict(attack_ms=6, decay_ms=55, sustain_level=0.6, release_ms=200,
               vibrato_hz=3.0, vibrato_depth=0.003)

# Start: Am -> C major
click = _wood_transient(0.012, volume=0.15, brightness=0.7)
ch1 = piano_chord([220, 262, 330], 0.30, 0.42, **ck)
ch2 = piano_chord([262, 330, 392], 0.38, 0.42, **ck_long)
r3.append(_reverb(np.concatenate([click, ch1, gap, ch2]), echoes=4, delay_ms=34, decay=0.26))

# Stop: C -> Am
click = _wood_transient(0.010, volume=0.12, brightness=0.4)
ch1 = piano_chord([262, 330, 392], 0.28, 0.42, **ck)
ch2 = piano_chord([220, 262, 330], 0.34, 0.42, **ck_long)
r3.append(_reverb(np.concatenate([click, ch1, gap, ch2]), echoes=4, delay_ms=34, decay=0.26))

# Success: arpeggiated G4 E4 C4 overlapping
click = _wood_transient(0.010, volume=0.12, brightness=0.6)
arp_gap_len = int(SR * 0.07)
an1 = _felt_piano(392, 0.50, volume=0.35, **ck)
an2 = _felt_piano(330, 0.45, volume=0.37, **ck)
an3 = _felt_piano(262, 0.55, volume=0.42, **ck_long)
total_s = int(SR * 0.8)
arp_s = np.zeros(total_s, dtype=np.float32)
arp_s[:min(len(an1), total_s)] += an1[:total_s]
o2 = arp_gap_len
arp_s[o2:o2 + min(len(an2), total_s - o2)] += an2[:total_s - o2]
o3 = arp_gap_len * 2
arp_s[o3:o3 + min(len(an3), total_s - o3)] += an3[:total_s - o3]
r3.append(_reverb(np.concatenate([click, arp_s]), echoes=5, delay_ms=35, decay=0.28))

# Cancel: single damped
click = _wood_transient(0.008, volume=0.10, brightness=0.2)
n1 = _felt_piano(262, 0.18, volume=0.32, **pk_damp)
n2 = _felt_piano(196, 0.22, volume=0.28, **pk_damp)
r3.append(_reverb(np.concatenate([click, n1, tiny, n2]), echoes=2, delay_ms=25, decay=0.15))

# Error: dissonant chord A3+Ab3
click = _wood_transient(0.012, volume=0.10, brightness=0.15)
err_ch = piano_chord([208, 220], 0.35, 0.30,
                     attack_ms=8, decay_ms=60, sustain_level=0.45,
                     release_ms=120, vibrato_hz=2.5, vibrato_depth=0.004)
r3.append(_reverb(np.concatenate([click, err_ch]), echoes=4, delay_ms=42, decay=0.22))

save_wav("REC3_rich_chords.wav", build_sequence(r3))

print()
print(f"All 3 recommendations saved to: {out_dir}")
print("Each plays: Start → (1s) → Stop → (1s) → Success → (1s) → Cancel → (1s) → Error")
