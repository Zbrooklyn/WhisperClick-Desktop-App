# DPI-Aware Window Dragging — Fix Specification

## Problem

Pywebview 6.1 frameless window drag breaks on multi-monitor setups with
different DPI scales (e.g., 125% primary + 150% laptop). Symptoms:

1. **First-frame jump**: Window teleports on first click-drag.
2. **Speed mismatch**: Window moves faster/slower than cursor on non-primary monitors.
3. **Cross-monitor glitches**: Drag breaks when moving between monitors with different DPIs.

## Root Cause

Pywebview's built-in `easy_drag` handler:

1. **JS** computes absolute CSS-pixel positions: `windowStartX + (ev.screenX - initialX)`
2. **Python** `move()` multiplies by `GetDpiForWindow(hwnd) / 96.0` to convert to physical pixels
3. **`SetWindowPos`** receives the scaled coordinates

This breaks because **CSS-to-physical scaling is non-linear across monitors**.
A CSS coordinate of 3200 on a 150% monitor does NOT convert to `3200 * 1.5`
in physical pixels — the first monitor's worth of CSS pixels maps at *its* DPI,
and only the remainder maps at the second monitor's DPI.

### Approaches Tried and Failed

| Approach | Why It Failed |
|----------|---------------|
| `easy_drag=True` + patched `move()` with `GetDpiForWindow` | DPI changes mid-drag when crossing monitors; absolute CSS→physical math is non-linear |
| `-webkit-app-region: drag` CSS | Not supported by pywebview's WebView2/Chromium backend |
| `WM_NCLBUTTONDOWN` via async API call | Mouse button state lost by the time Python executes (JS→Python bridge is async) |
| `pywebview-drag-region` class with `easy_drag=False` | Inconsistent behavior across monitors |

## Solution: Win32 Physical-Pixel Drag

**Bypass all CSS↔physical coordinate conversion.** Use Win32 APIs that operate
entirely in physical pixels:

- `GetCursorPos()` — returns physical screen coordinates
- `GetWindowRect()` — returns physical window position
- `SetWindowPos()` — accepts physical coordinates

The JavaScript side sends **signals only** (start/move/end), not coordinates.
Python handles all positioning math using physical pixels.

### Implementation

**`src/main.py`**:
```python
easy_drag=False,  # Disable pywebview's built-in drag
```

**`src/backend/api.py`** — three methods:
```python
_drag_state = {}

def drag_start(self):
    """Store physical cursor + window positions on mousedown."""
    cursor = wintypes.POINT()
    GetCursorPos(byref(cursor))
    hwnd = FindWindowW(None, "WhisperClick")
    rect = wintypes.RECT()
    GetWindowRect(hwnd, byref(rect))
    self._drag_state = {
        'cursor_x': cursor.x, 'cursor_y': cursor.y,
        'win_x': rect.left, 'win_y': rect.top,
        'hwnd': hwnd, 'active': True,
    }

def drag_move(self):
    """Compute physical-pixel delta and reposition window."""
    cursor = wintypes.POINT()
    GetCursorPos(byref(cursor))
    dx = cursor.x - self._drag_state['cursor_x']
    dy = cursor.y - self._drag_state['cursor_y']
    SetWindowPos(hwnd, 0, win_x + dx, win_y + dy, 0, 0,
                 SWP_NOSIZE | SWP_NOZORDER | SWP_NOACTIVATE)

def drag_end(self):
    """Clear drag state on mouseup."""
    self._drag_state['active'] = False
```

**`src/frontend/index.html`** — title bar handlers:
```javascript
const titleBar = document.getElementById('title-bar');
let dragging = false;

titleBar.addEventListener('mousedown', (e) => {
    if (e.target.closest('button, a, input, select')) return;
    dragging = true;
    window.pywebview.api.drag_start();
    e.preventDefault();
});

window.addEventListener('mousemove', () => {
    if (!dragging) return;
    window.pywebview.api.drag_move();
});

window.addEventListener('mouseup', () => {
    if (dragging) {
        dragging = false;
        window.pywebview.api.drag_end();
    }
});
```

### Why This Works

- **No DPI conversion**: All coordinates are physical pixels from Win32 APIs
- **Delta-based**: `new_pos = initial_window_pos + (current_cursor - initial_cursor)`,
  all in the same physical coordinate space
- **Cross-monitor safe**: `GetCursorPos()` returns consistent physical coordinates
  regardless of which monitor the cursor is on
- **No vendor patches needed**: Does not modify any pywebview library files

### Previous Vendor Patches (Now Obsolete)

The following patches from the old approach remain in the vendored pywebview files
but are **no longer active** because `easy_drag=False` disables the code paths:

- `customize.js`: Modified easy_drag handler to check `data-drag="true"`
- `winforms.py`: `move()` using `GetDpiForWindow` instead of cached scale factor
- `winforms.py`: Commented out `SetProcessDPIAware()` call

The DPI awareness setup in `main.py` (Per-Monitor V2) is still active and correct.

## Test Plan

1. Drag window on high-DPI primary monitor — smooth 1:1 tracking
2. Drag window on secondary monitor with different DPI — smooth 1:1 tracking
3. Drag window between monitors — no jump, no speed change
4. Click buttons in title bar (settings, minimize, close) — no unintended drag
5. Standalone test: `python tools/drag_test.py` — minimal test window for verification

## Maintenance Note

This solution is **self-contained** — no pywebview vendor patches required.
If pywebview is upgraded, only ensure `easy_drag=False` is still set.
The drag logic lives entirely in our code (`api.py` + `index.html`).
