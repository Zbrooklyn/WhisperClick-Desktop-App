# Translation Language Detection — Journey & Specification

## The Problem

When the user speaks English with `output_mode: "both"` and
`target_language: "en"`, the app should show a plain transcript.
Instead, it was triggering translation every time — producing a
"Transcript + Translation" card even though both were English.

## Why It Happened

The translation pipeline has three modes. Each had its own failure:

### Mode 1: Local (faster-whisper)

**Detection method**: `info.language` from faster-whisper's `model.transcribe()`.

**Status**: Worked most of the time. Faster-whisper returns an ISO 639-1 code
like `"en"` which we compare against `target_language`. Occasional misdetection
on very short utterances, but generally reliable.

### Mode 2: API — OpenAI (Whisper)

**Detection method**: None — `self.detected_language = None`.

The OpenAI Whisper API with the default `response_format` (plain text) only
returns the transcribed text. No language metadata. So `detected_language` was
always `None`, falling through to the heuristic.

### Mode 3: API — Gemini

**Detection method**: None — Gemini's `generateContent` endpoint returns only
the transcription text. Same `None` fallthrough to heuristic.

### The Heuristic Fallback (`_guess_language`)

When `detected_language` was `None`, the code fell back to a character-script
heuristic:

```python
ascii_letters = sum(1 for c in chars if 'a' <= c.lower() <= 'z')
total = len(chars)  # <-- BUG: includes spaces, punctuation, numbers

if ascii_letters / total > 0.85 and target_lang == "en":
    return "en"
```

For `"Hello, how are you?"`:
- ASCII letters: 15
- Total characters: 19 (includes 3 spaces, comma, question mark)
- Ratio: 15/19 = **79%** — below the 85% threshold
- Result: `"auto"` — translation fires

**Any English sentence with normal punctuation fails the threshold.**

## The Fix — Three Layers

### Layer 1: OpenAI verbose_json (primary fix)

Changed `_transcribe_openai()` to use `response_format="verbose_json"`.
The Whisper API then returns a `language` field (e.g., `"english"`).

```python
call_kwargs = {
    "model": model,
    "file": audio_file,
    "response_format": "verbose_json",  # NEW — returns language field
}
```

Map full language names to ISO codes:
```python
_LANG_NAME_TO_CODE = {
    "english": "en", "spanish": "es", "french": "fr", ...
}
lang_name = getattr(response, "language", None)
self.detected_language = _LANG_NAME_TO_CODE.get(lang_name.lower(), ...)
```

Now OpenAI API mode works the same as local mode — real language detection,
no heuristic needed.

### Layer 2: Fixed heuristic (Gemini fallback)

Gemini doesn't return language metadata, so the heuristic is still the
fallback. Fixed the ratio to count only letters, not total characters:

```python
# BEFORE (broken):
total = len(chars)  # spaces, punctuation inflate denominator

# AFTER (fixed):
total_letters = ascii_letters + cjk + hangul + kana + arabic + devanagari
if total_letters == 0:
    return "auto"
if ascii_letters / total_letters > 0.85 and target_lang == "en":
    return "en"
```

For `"Hello, how are you?"`:
- ASCII letters: 15, total letters: 15
- Ratio: 15/15 = **100%** — correctly returns `"en"`

### Layer 3: Translation pipeline skip logic (unchanged)

The decision logic in `stop_recording()` chains all detection methods:

```python
effective_source = source_language                               # "auto"
if effective_source == "auto" and detected_language:
    effective_source = detected_language                          # from Whisper
if effective_source == "auto" and text.strip():
    effective_source = _guess_language(text, target_language)     # heuristic

skip_translate = (effective_source != "auto"
                  and effective_source.lower() == target_language.lower())
```

Plus a final safety net: if the translation result is identical to the
transcript, it's discarded:
```python
elif translation.strip().lower() == text.strip().lower():
    output_text = text  # Same text — no point showing both
```

## Detection Coverage Matrix

| Mode | Source | Detection Method | Reliability |
|------|--------|-----------------|-------------|
| Local | faster-whisper | `info.language` (ISO code) | High — model-based |
| API (OpenAI) | Whisper API | `verbose_json` → `language` field | High — model-based |
| API (Gemini) | generateContent | `_guess_language()` heuristic | Medium — script-based |
| All modes | — | Identical text comparison | Safety net |

## Known Limitations

1. **Gemini heuristic can't distinguish Latin-script languages** — if the user
   speaks French with `target_language: "fr"`, the heuristic can't tell it's
   French (not English). It only works when `target_lang == "en"` and the text
   is mostly ASCII.

2. **Very short utterances** (< 5 characters) skip heuristic entirely and
   return `"auto"`, which means translation fires. This is intentional — there
   isn't enough signal to detect language from 1-2 words.

3. **Custom OpenAI-compatible endpoints** (e.g., local Whisper servers) may not
   support `verbose_json`. If the endpoint ignores the format parameter and
   returns plain text, the SDK may raise an error. If this becomes an issue,
   we'd need a try/fallback pattern.

## Files Modified

- `src/backend/transcription.py` — `verbose_json` format, `_LANG_NAME_TO_CODE` mapping
- `src/backend/api.py` — Fixed `_guess_language()` ratio denominator

## Test Plan

1. **Local mode, English speech** → No translation card
2. **OpenAI API mode, English speech** → No translation card
3. **OpenAI API mode, non-English speech** → Translation card appears
4. **Gemini API mode, English speech** → No translation card (heuristic)
5. **Short utterance (1-2 words)** → May still translate (acceptable)
6. **Mixed-language speech** → Translation fires (correct behavior)
