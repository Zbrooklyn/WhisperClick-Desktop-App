# WhisperClick Sound Design

## Current Version: v4 "Intimate Piano + Deep Bass"

**File:** `src/backend/tones.py`
**Style:** Octave-doubled felt piano with wooden transients, sub-bass, and deep bass
**Approach:** All tones pre-rendered at module load for instant playback

---

## Architecture

Each tone is built from up to 5 layers, mixed and normalized:

```
Layer 1: Wood Transient    ~10ms    Attack character (pluck/tap/brush)
Layer 2: Felt Piano (high) ~200ms+  Main melody note (C4, G4, etc.)
Layer 3: Felt Piano (low)  ~200ms+  Octave below for warmth (C3, G3, etc.)
Layer 4: Sub-bass          ~350ms+  2 octaves below root, felt piano synthesis
Layer 5: Deep bass         ~400ms+  3 octaves below root, pure sine (32-65 Hz)
```

After mixing, reverb is applied, then normalization to a target peak level.

---

## The 5 Tones

### Start Tone — "I'm listening"
- **Trigger:** User clicks pill to begin recording
- **Musical content:** Rising fifth C4 -> G4, octave-doubled
- **Character:** Inviting, opening — like a door into a warm room
- **Layers:** Wood pluck (bright) + piano C4 + piano G4 + sub-bass + deep bass
- **Peak volume:** 0.80
- **Approx duration:** ~650ms + reverb tail

### Stop Tone — "Got it"
- **Trigger:** User clicks stop button to end recording
- **Musical content:** Single damped C4, octave-doubled
- **Character:** Quick, confirming — like closing a book
- **Layers:** Wood tap (soft) + damped piano C4 + sub-bass + deep bass
- **Peak volume:** 0.72
- **Approx duration:** ~380ms + reverb tail
- **Design note:** Single note chosen over two-note descending fifth (tested both, single felt more decisive)

### Success Tone — "Ready!"
- **Trigger:** Transcription complete, text copied to clipboard
- **Musical content:** Resolving triad G4 -> E4 -> C4, final note octave-doubled
- **Character:** Satisfying, resolved — the reward moment
- **Layers:** Wood pluck (medium) + piano triad + sub-bass blooms on final note + deep bass blooms on final note
- **Peak volume:** 0.85 (fullest of all tones)
- **Approx duration:** ~550ms + reverb tail

### Cancel Tone — "Never mind"
- **Trigger:** User clicks X to cancel recording
- **Musical content:** Descending C4 -> G3, damped (no octave doubling on piano)
- **Character:** Retreating, dissolving — warmth pulling away
- **Layers:** Wood brush (muted) + damped piano + subtle sub-bass + subtle deep bass
- **Peak volume:** 0.55 (quietest of all tones)
- **Approx duration:** ~380ms + reverb tail
- **Design note:** Deliberately thinner/drier than other tones. No octave doubling on piano layer.

### Error Tone — "Hmm, something's wrong"
- **Trigger:** Transcription fails or API error
- **Musical content:** Half-step dissonance A3 -> Ab3, octave-doubled
- **Character:** Concerned but not alarming — a thoughtful pause
- **Layers:** Wood thud (dull) + low piano + sub-bass + deep bass
- **Peak volume:** 0.70
- **Approx duration:** ~550ms + reverb tail

---

## Volume Hierarchy

Intentional relative loudness for emotional weight:

```
Success  0.85  ██████████████████  (the reward — fullest)
Start    0.80  ████████████████    (present but not demanding)
Stop     0.72  ██████████████      (confirming, slightly softer)
Error    0.70  █████████████       (informative, not alarming)
Cancel   0.55  ██████████          (retreating — noticeably quieter)
```

---

## Synthesis Details

### Felt Piano (`_felt_piano`)
What makes it sound like a real piano vs a generic sine tone:
- **Inharmonicity (B=0.0004):** Upper partials are slightly sharp. Real piano strings exhibit this because of stiffness. Formula: `f_n = f * n * sqrt(1 + B * n^2)`
- **Dual-string detuning (0.8 Hz):** Real pianos have 2-3 strings per note, never perfectly in tune. The beating between them creates the characteristic piano shimmer.
- **Partial rolloff:** Amplitude decreases with partial number: `1.0, 0.45, 0.18, 0.08, 0.03, 0.01`
- **Per-partial decay:** Higher partials decay faster, simulating string damping. Formula: `exp(-t * partial_n * 1.5 / (duration * damping))`
- **Damping parameter:** Controls how fast the note dies. 0.5 = very muted (soft pedal), 1.0 = normal, 1.5 = extra ring (sustain pedal feel)

### ADSR Envelope (`_adsr`)
All notes use Attack-Decay-Sustain-Release instead of simple exponential decay:
```
1.0 |   /\
    |  /  \___________
S   | /    sustain     \
    |/                  \
0.0 |A  D    S       R
```
- **Attack (A):** 5-12ms — the initial strike
- **Decay (D):** 40-80ms — settles from peak to sustain level
- **Sustain (S):** 0.4-0.6 — the note lives here (this is what makes it sound "alive")
- **Release (R):** 80-200ms — natural fade to zero (prevents audio pops)

### Wood Transient (`_wood_transient`)
Shaped noise burst that simulates the physical attack of a wooden instrument:
- **Brightness (0.0-1.0):** Controls low-pass filter kernel size. 0.0 = dull thud, 1.0 = bright tap
- **Body resonance:** A subtle low sine bump (120-200 Hz) that gives the "body of the instrument" feeling
- Varies per tone: start=0.7 (bright pluck), stop=0.3 (soft tap), cancel=0.2 (muted brush), error=0.15 (dull thud)

### Sub-bass (`_sub_bass`)
Felt piano synthesis 2 octaves below the root note:
- Same dual-string, inharmonic character as main piano but at very low frequencies
- Slower attack (12ms) and longer release (150ms) than main piano
- Adds warmth you can hear on decent speakers

### Deep Bass (`_deep_bass`)
Pure sine wave 3 octaves below root (floored at 32 Hz):
- No harmonics — just raw low-frequency weight
- A touch of the octave above (0.3 amplitude) for definition on smaller speakers
- Slow swell envelope: 20ms attack, 200ms release
- You feel this in your chest more than hear it

### Reverb (`_reverb`)
Simple echo-based reverb. Each tone has custom reverb settings:
- **echoes:** Number of reflections (2-5)
- **delay_ms:** Time between reflections (25-42ms)
- **decay:** Volume multiplier per reflection (0.15-0.28)

---

## Parameter Presets

Four reusable parameter dictionaries for the felt piano:

| Preset | Use | attack | decay | sustain | release | vibrato | damping |
|--------|-----|--------|-------|---------|---------|---------|---------|
| `_PK` | Standard notes | 6ms | 55ms | 0.6 | 130ms | 3.5Hz/0.002 | 1.0 |
| `_PK_LONG` | Final/landing notes | 6ms | 55ms | 0.6 | 180ms | 3.0Hz/0.003 | 1.3 |
| `_PK_DAMP` | Cancel/muted notes | 5ms | 40ms | 0.4 | 80ms | none | 0.5 |
| `_PK_ERR` | Error notes | 8ms | 55ms | 0.45 | 100ms | 2.5Hz/0.003 | 0.7 |

---

## Musical Choices

### Key: C major
All tones are in C major (C4 = 262 Hz as root). This was chosen for warmth — C4 sits in the comfortable middle register, not too bright, not too muddy.

### Intervals
- **Start:** Rising perfect fifth (C4 -> G4) — open, inviting
- **Stop:** Single note (C4) — decisive, grounded
- **Success:** Descending major triad (G4 -> E4 -> C4) — resolving, satisfying
- **Cancel:** Descending perfect fifth (C4 -> G3) — retreating
- **Error:** Half-step dissonance (A3 -> Ab3) — unsettling without being alarming

### Octave Doubling
Most notes play in two octaves simultaneously (e.g., C3 + C4). The low octave is mixed at 45% and the high at 55%. This creates a fuller, warmer sound than a single note without sounding like a chord.

Exception: Cancel tone does NOT use octave doubling on the piano layer (only on bass layers), making it deliberately thinner — the warmth retreats with the sound.

---

## Pre-rendering

All 5 tones are synthesized once at `import` time and stored as numpy arrays:
```python
_TONE_START = _render_start()
_TONE_STOP = _render_stop()
# etc.
```
Public functions just call `sd.play()` on the cached array. This eliminates any synthesis delay on trigger — playback is instant.

**Trade-off:** ~0.1s added to module import time. Acceptable since this only happens at app startup.

---

## Evolution History

### v1: Basic sine tones (initial implementation)

**Synthesis:** Simple `_note()` function with custom harmonic series + exponential decay envelope.
No ADSR, no vibrato, no bass layers. Each tone was a single-layer synth.

**Register:** D5/A5 range (587-880 Hz) — bright and attention-grabbing.

**4 timbre presets:**
```python
HARMONICS_BRIGHT = [(1, 1.0), (2, 0.4), (3, 0.2), (4, 0.08), (5, 0.04)]
HARMONICS_MUTED  = [(1, 1.0), (2, 0.15), (3, 0.03)]
HARMONICS_ROUND  = [(1, 1.0), (2, 0.35), (3, 0.12), (4, 0.05)]
HARMONICS_HOLLOW = [(1, 1.0), (3, 0.25), (5, 0.08)]
```

**Tone definitions:**
| Tone | Notes | Harmonics | Volume | Duration | Decay curve | Issue |
|------|-------|-----------|--------|----------|-------------|-------|
| Start | D5(587) -> A5(880) | Bright | 0.18/0.22 | 110ms+150ms | 5.5/4.5 | OK — user liked this |
| Stop | D5(587) single | Muted | 0.16 | 90ms | 8.0 | **Inaudible** — too quiet, too short, too fast decay |
| Success | A5(880) -> F#5(740) -> D5(587) | Round | 0.16/0.18/0.22 | 100+100+220ms | 5.0/5.0/3.5 | OK |
| Cancel | (none) | — | 0 | 0ms | — | **No sound at all** — never wired |
| Error | D4(294) -> Db4(277) | Hollow | 0.14/0.12 | 130+170ms | 4.0/3.5 | OK |

**Problems identified:**
- Stop tone completely inaudible (volume 0.16, muted harmonics, 8.0 decay = dies in ~10ms)
- Cancel button had zero sound — was never connected
- All tones used simple exponential decay — notes just "die" immediately, no sustain

---

### v1.5: Stop tone fix + cancel tone added

**Changes to stop tone:**
- Changed from single muted D5 to descending fifth A5->D5
- Harmonics: Bright + Round (from Muted)
- Volume: 0.32/0.35 (from 0.16)
- Duration: 140ms+180ms (from 90ms)
- Decay: 4.0/3.5 (from 8.0)

**New cancel tone:**
- Notes: D5(587) -> A4(440), two descending notes
- Harmonics: Round + Muted
- Volume: 0.28/0.25
- Duration: 110ms+130ms

**Feedback:** Stop now audible but "too subtle." Cancel still too quiet to notice.

---

### v2: ADSR envelopes + vibrato

**Core synthesis rewrite:** Replaced exponential decay with proper ADSR envelopes.

**New `_adsr()` function:**
```
Attack (5-6ms)  -> Decay (30-50ms) -> Sustain (0.5-0.65) -> Release (50-120ms)
```
Notes now hold at a sustain level instead of immediately dying. This was the biggest improvement to making tones feel "alive."

**Added vibrato:** Subtle pitch modulation (4-4.5 Hz, depth 0.002-0.003) during sustain. Barely perceptible but adds organic quality.

**All volumes boosted** to 0.28-0.42 range (from 0.16-0.22). User said "don't worry about it being too loud."

**Still in D5/A5 range** — user feedback: "sounds a little too high-pitched... I prefer something warmer."

---

### v2.5: Register drop to C4/G4

**Dropped all frequencies by roughly one octave:**

| Tone | Before (v2) | After (v2.5) |
|------|-------------|--------------|
| Start | D5(587) -> A5(880) | C4(262) -> G4(392) |
| Stop | A5(880) -> D5(587) | G4(392) -> C4(262) |
| Cancel | D5(587) -> A4(440) | C4(262) -> G3(196) |
| Success | A5(880) -> F#5(740) -> D5(587) | G4(392) -> E4(330) -> C4(262) |
| Error | D4(294) -> Db4(277) | A3(220) -> Ab3(208) |

**Feedback:** Much warmer. "Comfortable, warm, and inviting" — good for daily use.

---

### v3: Three-layer instrument architecture

**Major rewrite** — moved from single-layer synthesis to three distinct instrument layers:

**Layer 1: Wood Transient (`_wood_transient`)**
- Shaped noise burst with adjustable brightness (0.0=dull thud, 1.0=bright tap)
- Added body resonance: low sine bump (120-200 Hz) for "wood" feeling
- Different brightness per tone: start=0.7, stop=0.4, cancel=0.2, error=0.15

**Layer 2: Felt Piano (`_felt_piano`)**
- Inharmonicity coefficient B=0.0004 (upper partials drift sharp like real piano)
- Dual-string detuning: 0.8 Hz between two copies (simulates real piano's 2-3 strings per note)
- 6 partials with natural rolloff: 1.0, 0.45, 0.18, 0.08, 0.03, 0.01
- Per-partial decay: higher partials die faster
- Damping parameter (0.5=muted, 1.0=normal, 1.5=extra ring)

**Layer 3: String Pad (`_string_pad`)**
- Sawtooth approximation: sum of sin(n*f*t)/n for n=1..6
- Very slow attack (150-200ms) — fades in, doesn't hit
- Heavy chorus detuning for width
- Used underneath start, stop, and success tones

**Instrument comparison testing:**
Generated 7 WAV files (saved in `Desktop/whisperclick_sounds/archive_v1/`):
- A: Felt piano single notes
- B: Piano chord (C+E+G simultaneous)
- C: Octave-doubled piano (C3+C4)
- D: Soft damped piano
- E: Piano + piano pad
- F: Arpeggiated chord
- G: Low warm piano (C3 range)

**3 full recommendation packages generated (all 5 tones in sequence):**
- REC1: Intimate Piano — octave-doubled, clean, warm
- REC2: Piano with Depth — piano + piano pad swells underneath
- REC3: Rich Chords — full 3-note chords

**User feedback:**
- "I like recording 1 the most"
- "Recording 2 also, it just doesn't feel as smooth" (pad's slow attack felt disconnected)
- "Recording 3 didn't really like" (chords too busy)
- String pad identified as the sound user didn't like

---

### v3.5: Stop tone — single note

**User feedback on stop:** "Maybe it should be one note instead of 2."

**Generated 3 options:**
- STOP_A: Single octave-doubled C4, full sustain — warm and settled
- STOP_B: Single octave-doubled G4, shorter — brighter tap
- STOP_C: Single damped C4, octave-doubled — shorter, more muted

**User chose: STOP_C (damped C4)** — quick, doesn't linger, "closing a book" quality.

**Parameters:**
```python
_octave_note(262, 0.28, 0.38,
             attack_ms=6, decay_ms=50, sustain_level=0.45,
             release_ms=100, damping=0.7)
```

---

### v4: Intimate Piano + Deep Bass (current)

**Removed string pad layer** — cleaner without it. User didn't like the string texture.

**Added two bass layers:**

**Sub-bass (`_sub_bass`):** Felt piano synthesis 2 octaves below root.
```python
_felt_piano(freq/4, duration*1.1, volume=0.12,
            attack_ms=12, decay_ms=70, sustain_level=0.5, release_ms=150)
```

**Deep bass (`_deep_bass`):** Pure sine wave 3 octaves below root (floored at 32 Hz).
```python
bass_freq = max(freq/8, 32)
wave = sin(2*pi*bass_freq*t) + 0.3*sin(2*pi*bass_freq*2*t)
# ADSR: attack=20ms, decay=80ms, sustain=0.7, release=200ms
```

**A/B/C comparison testing:**
- COMPARE_A: No bass layers (flat, thin)
- COMPARE_B: Sub-bass only (warmer, but user wanted more)
- COMPARE_C: Sub-bass + deep bass (user: "I love it")

**Pre-rendering added:** All 5 tones synthesized at module import, stored as numpy arrays. Public functions just call `sd.play()` on cached audio — zero synthesis delay.

**Volume hierarchy finalized:**
```
Success  0.85  (the reward — fullest)
Start    0.80  (present but not demanding)
Stop     0.72  (confirming, slightly softer)
Error    0.70  (informative, not alarming)
Cancel   0.55  (retreating — noticeably quieter)
```

**Final tone specifications:**

| Tone | Notes | Layers | Peak | Key parameters |
|------|-------|--------|------|----------------|
| Start | C4->G4 rising 5th | wood(0.7) + octave piano + sub(0.14) + deep(0.20) | 0.80 | _PK, _PK_LONG |
| Stop | C4 single damped | wood(0.3) + octave piano + sub(0.10) + deep(0.16) | 0.72 | damping=0.7 |
| Success | G4->E4->C4 triad | wood(0.6) + piano+octave on final + sub(0.14) + deep(0.20) on final | 0.85 | _PK, _PK_LONG |
| Cancel | C4->G3 descending | wood(0.2) + damped piano (no octave) + sub(0.08) + deep(0.12) | 0.55 | _PK_DAMP |
| Error | A3->Ab3 dissonance | wood(0.15) + octave piano + sub(0.12) + deep(0.18) | 0.70 | _PK_ERR |

---

## Testing

### Generate preview WAV
Run `generate_samples.py` to create WAV files on Desktop:
```
python generate_samples.py
```

### Test in widget
```
python run_pill.py
```
Click pill to start, click stop/X to hear tones. Processing -> success plays after 2s delay.

### Quick tone test from command line
```python
from src.backend.tones import play_start_tone, play_stop_tone
play_start_tone()  # instant — uses pre-rendered cache
```

---

## Future Improvements (Tabled)

### Higher quality piano (soundfont approach)
Explored using FluidSynth with a real piano soundfont (.sf2) for dramatically more realistic piano sound. Requires:
- `pyfluidsynth` package
- FluidSynth Windows DLL (downloaded to `fluidsynth/bin/`)
- A piano soundfont file (e.g., FluidR3_GM.sf2)
- **Status:** Tabled for now. Current synthesis is good enough. Revisit when shipping.

### Sound preferences
- User should be able to adjust overall sound volume (or mute) in settings
- Could offer 2-3 sound "themes" (e.g., Intimate Piano, Bright Chimes, Silent)

### Repeat fatigue testing
- Start tone fires most often — monitor for annoyance over extended use
- Consider slightly randomizing parameters (pitch +/- 1Hz, timing +/- 5ms) so it's never identical twice
