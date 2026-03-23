# Frameless Window Design — WhisperClick Tauri

**Date:** 2026-03-23
**Status:** Validated via test app (all 6 checks passed)

## Problem

WhisperClick Electron uses `titleBarStyle: 'hidden'` + `titleBarOverlay` for a custom title bar with native min/max/close buttons. Tauri has no equivalent of `titleBarOverlay`. The app currently runs with `decorations(true)` (native Windows title bar), which looks generic and doesn't match the Electron design.

## Validated Approach

`decorations(false)` + `data-tauri-drag-region` + custom HTML buttons.

Confirmed working in `platforms/frameless-test/` with all 6 checks passing:
1. No native title bar
2. Window dragging via `data-tauri-drag-region`
3. Minimize via `plugin:window|minimize`
4. Maximize via `plugin:window|toggle_maximize`
5. Close via `plugin:window|close`
6. Window resizing from edges/corners

**Note:** The test app uses Tauri plugin APIs directly (`plugin:window|*`). The main app routes through custom Rust commands (`window_minimize`, `window_maximize`, `window_close`) via bridge.js `invoke()`. Both approaches work — the custom commands already implement toggle logic.

## Why Previous Attempts Failed

All prior frameless attempts failed due to **CSP nonce injection** (fixed in commit `36baa4a`). Tauri auto-injected nonces that disabled `'unsafe-inline'`, blocking all `onclick` handlers and inline styles. With `"csp": null` + `"dangerousDisableAssetCspModification": true`, this is resolved.

## Changes Required

### 1. `platforms/tauri/src/lib.rs` — Window creation

Change:
```rust
.decorations(true)
```
To:
```rust
.decorations(false)
.shadow(true)  // Restore window shadow lost by removing decorations
```

### 2. `platforms/tauri/bridge.js` — CSS injection

Update the `_injectTauriCSS()` function to:
- Unhide `.electron-hide` elements (custom min/max/close buttons)
- Remove the 140px right padding Electron reserves for `titleBarOverlay`
- Disable `-webkit-app-region` (not supported by WebView2)

```css
/* Show custom window controls (hidden in Electron which has native overlay) */
.electron-hide { display: inline-flex !important; }

/* Title bar: remove Electron overlay padding, disable webkit drag */
#title-bar {
  -webkit-app-region: initial !important;
  padding-right: 12px !important;
}
#title-bar button, #title-bar a, #title-bar input,
#title-bar select, #title-bar [onclick] {
  -webkit-app-region: initial !important;
}
```

### 3. `platforms/tauri/bridge.js` — Add drag region attribute

After DOM loads, inject `data-tauri-drag-region` onto `#title-bar` and all non-interactive descendants. This attribute only applies to elements it's directly on — it does NOT inherit.

```javascript
function _addDragRegions() {
  const titleBar = document.getElementById('title-bar');
  if (!titleBar) return;
  titleBar.setAttribute('data-tauri-drag-region', '');
  // Add to ALL descendants EXCEPT interactive elements
  titleBar.querySelectorAll('*').forEach(el => {
    if (!el.closest('button') && !el.closest('a') &&
        !el.closest('input') && !el.closest('select')) {
      el.setAttribute('data-tauri-drag-region', '');
    }
  });
}
```

Run on DOMContentLoaded:
```javascript
if (document.body) _addDragRegions();
else document.addEventListener('DOMContentLoaded', _addDragRegions);
```

### 4. `platforms/tauri/bridge.js` — Add `toggle_maximize` alias

The frontend calls `callNativeApi('toggle_maximize')` (index.html line 4588) but bridge.js only exposes `maximize()`. Without this alias, the maximize button silently fails (returns null).

Add to the `window.pywebview.api` object:
```javascript
async toggle_maximize() {
  return await trackedInvoke('window_maximize');
},
```

### 5. `platforms/tauri/capabilities/default.json` — Permissions

Add (required for `data-tauri-drag-region` to function):
```json
"core:window:allow-start-dragging"
```

### 6. `platforms/tauri/bridge.js` — Double-click to maximize

`data-tauri-drag-region` may not provide double-click-to-maximize natively. Add a handler to match Windows behavior:

```javascript
function _addDoubleClickMaximize() {
  const titleBar = document.getElementById('title-bar');
  if (!titleBar) return;
  titleBar.addEventListener('dblclick', (e) => {
    // Only on the drag region, not on buttons
    if (e.target.closest('button') || e.target.closest('a')) return;
    trackedInvoke('window_maximize');
  });
}
```

## What NOT to Change

- **`shared/frontend/index.html`** — No modifications. The `.electron-hide` class stays. Tauri overrides via bridge CSS injection, keeping Electron unaffected.
- **`#app-frame` border/shadow** — Line 25 of index.html sets `border: none; box-shadow: none`. Leave as-is.
- **Rust window commands** — `window_minimize`, `window_maximize`, `window_close` already work. No Rust changes needed beyond `decorations(false)` + `.shadow(true)`.
- **Pill window** — Already frameless. No changes needed.

## Electron vs Tauri Comparison

| Aspect | Electron | Tauri |
|--------|----------|-------|
| Native chrome | `titleBarStyle: 'hidden'` | `decorations(false)` |
| Window controls | Native overlay buttons | Custom HTML buttons (unhide `.electron-hide`) |
| Dragging | `-webkit-app-region: drag` CSS | `data-tauri-drag-region` attribute |
| Double-click maximize | Native (free with drag region) | Custom `dblclick` handler on title bar |
| Snap layouts | Native (hover maximize) | Not available without native controls |
| Window shadow | Native | `.shadow(true)` on builder |
| Custom button style | Hidden (native overlay used) | Visible, styled to match design |

## Known Limitations

1. **Windows 11 Snap Layouts** — Requires native window controls. Not available with `decorations(false)`. Acceptable — small fixed-size app window, not a workflow feature.
2. **System menu** — Right-click on title bar and Alt+Space system menu lost with frameless. Minor — not part of the app's UX.

## Test Plan

1. Apply changes to main WhisperClick app
2. Launch and verify: no native title bar, custom buttons visible
3. Test drag from title bar area (grab text, icon, empty space)
4. Test min/max/close buttons
5. Test double-click on title bar to maximize
6. Test drag while maximized (should restore and begin drag)
7. Test resize from edges/corners
8. Verify onboarding buttons still work (CSP regression check)
9. Verify settings drawer opens
10. Verify tray icon click shows window
11. Compare visual appearance with Electron version
