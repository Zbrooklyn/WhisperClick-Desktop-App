# Window Sizing Specification

## Problem

The main window opens at a fixed 520x820 logical pixels. On high-DPI displays (4K at 125% scaling), this renders as ~628x966 physical pixels — only 16% of screen width. Users report it feels "way too small." On smaller displays (1080p laptops), the same 520px can feel proportionally large. The size needs to adapt to the display.

## Solution

Calculate window dimensions as a **percentage of the screen's effective resolution**, clamped to a minimum and maximum so it never gets too cramped or too wide.

### Formula

```
target_width  = screen_width * 0.22       (22% of effective screen width)
actual_width  = clamp(target_width, 480, 650)   (logical pixels)
actual_height = actual_width * 1.58              (maintain aspect ratio)
actual_height = max(actual_height, 620)          (height floor)
```

### Parameters

| Parameter | Value | Reason |
|-----------|-------|--------|
| Target % | 22% | Feels substantial without dominating the screen |
| Width floor | 480px | Below this, controls and text get cramped |
| Width cap | 650px | Single-column UI doesn't benefit from more |
| Aspect ratio | 1.58 | Current 820/520 ratio — tall and narrow, app-like |
| Height floor | 620px | Matches current min_size constraint |

### Expected Results

| Screen | Effective Res | 22% Width | Clamped Width | Clamped Height | % of Screen |
|--------|--------------|-----------|---------------|----------------|-------------|
| 13" laptop 1080p | 1920x1080 | 422 | 480 (floor) | 758 | 25% |
| 14" laptop 1440p | 2560x1440 | 563 | 563 | 890 | 22% |
| 27" desktop 4K @150% | 2560x1440 eff | 563 | 563 | 890 | 22% |
| 27" desktop 4K @125% | 3072x1728 eff | 676 | 650 (cap) | 1027 | 21% |
| 32" desktop 4K @100% | 3840x2160 | 845 | 650 (cap) | 1027 | 17% |

### Size Persistence

Once the user manually resizes the window, the new size is saved (position + size in `window_pos.json`) and restored on next launch via Win32 `SetWindowPos`. The percentage-based default only applies on first launch or when saved data is missing.

### How It Works

1. On launch, check for saved size in `~/.config/whisperclick/window_pos.json`
2. If saved size exists and position is on-screen: restore exact saved size via `SetWindowPos`
3. If no saved size: calculate default from the target monitor's effective resolution
4. The effective resolution is determined by dividing the physical resolution by the DPI scale factor
5. `min_size` for the window is set to (480, 620) so the user can't shrink it below usable

### Implementation Location

- `src/main.py` — window creation and size calculation
- `~/.config/whisperclick/window_pos.json` — persisted position + size
