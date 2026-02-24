# Maximize Button + Windows Snap — Change Log

## Goal
Add maximize/restore button + Windows snap support (drag-to-edge, Win+Arrow) to the frameless pywebview window, with no visible native frame or accent border.

## Final Status (2026-02-24)

| Feature | Status | Notes |
|---------|--------|-------|
| Maximize button (UI) | WORKING | Square icon between minimize and close |
| toggle_maximize() API | WORKING | IsZoomed + ShowWindow |
| Double-click title bar | WORKING | mousedown timing (300ms threshold) |
| Maximize icon swap | WORKING | is_maximized() API + `[data-lucide]` selector |
| Win+Arrow snap | WORKING | Via WS_THICKFRAME + WS_MAXIMIZEBOX |
| Drag-to-edge snap | WORKING | Native drag via WM_APP_DRAGSTART → HTCAPTION |
| Snap Layouts (Win+Z) | WORKING | Automatic with WS_THICKFRAME + WS_MAXIMIZEBOX |
| Title bar drag | WORKING | WM_APP_DRAGSTART pattern (see below) |
| Edge resize (L/R/B) | WORKING | Via WS_THICKFRAME |
| Edge resize (Top) | WORKING | WM_NCHITTEST hook + WM_APP_NCRESIZE |
| Accent border line | FIXED | WM_NCCALCSIZE removes top NC area |
| Onboarding overlay | FIXED | top-10 so title bar stays visible |
| Settings drawer | FIXED | top-10 so title bar stays visible |

## Architecture: The WM_APP_DRAGSTART Pattern

The core breakthrough is a custom-message approach that bridges the JS thread to the Win32 UI thread:

1. JS mousedown on title bar → calls `window.pywebview.api.drag_start()`
2. `drag_start()` calls `PostMessageW(hwnd, WM_APP_DRAGSTART, 0, 0)` (0x8001)
3. WndProc hook receives WM_APP_DRAGSTART on the UI thread
4. Hook calls `ReleaseCapture()` (releases WebView2's mouse capture)
5. Hook calls `SendMessageW(hwnd, WM_NCLBUTTONDOWN, HTCAPTION, 0)`
6. Windows enters its native modal drag loop — snap, aero shake, etc. all work

Why this works: WebView2 captures mouse events in its child window. Direct WM_NCHITTEST subclassing on the parent window never sees mouse messages from the WebView2 area. Calling ReleaseCapture + SendMessage on the UI thread (via PostMessage) bypasses this entirely.

## WndProc Hook (`_install_nchittest_hook` in main.py)

Single WndProc subclass handles four messages:

| Message | Handler | Purpose |
|---------|---------|---------|
| WM_NCHITTEST | Returns HTTOP/HTTOPLEFT/HTTOPRIGHT for top-edge resize, HTCAPTION for title bar drag area (fallback, mostly unused since WebView2 intercepts) | Top-edge resize detection |
| WM_NCCALCSIZE | Saves proposed_top from NCCALCSIZE_PARAMS, calls default, restores top (skips when IsZoomed) | Removes accent border by zeroing top NC area |
| WM_APP_DRAGSTART (0x8001) | ReleaseCapture() + SendMessage(WM_NCLBUTTONDOWN, HTCAPTION) | Native drag with snap |
| WM_APP_NCRESIZE (0x8002) | ReleaseCapture() + SendMessage(WM_NCLBUTTONDOWN, wParam) | Top-edge resize (wParam = HTTOP/HTTOPLEFT/HTTOPRIGHT) |

## Files Modified

### src/main.py
- Added `_install_nchittest_hook(hwnd)` — WndProc subclass with all four message handlers
- Added module-level `_wndproc_ref = None` to prevent GC of ctypes callback
- In `_restore_and_save()`: added WS_THICKFRAME + WS_MAXIMIZEBOX styles, DwmSetWindowAttribute for border color, hook installation, SWP_FRAMECHANGED after hook

### src/backend/api.py
- Added `_find_hwnd()` static method — tries both "WhisperClick" and "WhisperClick [DEV]"
- Added `toggle_maximize()` — IsZoomed + ShowWindow(SW_MAXIMIZE/SW_RESTORE)
- Added `is_maximized()` — returns bool(IsZoomed(hwnd))
- Added `nc_resize_start(hit_code)` — PostMessageW(hwnd, WM_APP_NCRESIZE, hit_code, 0)
- Changed `drag_start()` — now PostMessageW(hwnd, WM_APP_DRAGSTART, 0, 0)
- `drag_move()` and `drag_end()` — no-ops (native drag handles everything)

### src/frontend/index.html
- Added maximize button HTML between minimize and close divider
- Added `toggleMaximize()` — calls API, updates icon after 150ms
- Added `updateMaximizeIcon()` — uses `callNativeApi('is_maximized')` + `querySelector('[data-lucide]')` (handles both `<i>` and `<svg>` after Lucide render)
- Added resize event listener for icon sync (snap, Win+Arrow)
- Changed title bar drag handler — mousedown only, no mousemove/mouseup
- Added double-click detection via mousedown timing (300ms threshold)
- Added top-edge resize grip (6px zone) with cursor changes and nc_resize_start calls
- Changed onboarding overlay from `inset-0` to `inset-0 top-10` (title bar always visible)
- Changed settings drawer from `inset-0` to `inset-0 top-10` (title bar always visible)

## Approaches That Failed (and Why)

### Title bar drag

| # | Approach | Result | Root Cause |
|---|----------|--------|------------|
| 1 | SendMessageW(WM_SYSCOMMAND, SC_MOVE \| HTCAPTION) | Deadlock | SendMessage blocks JS bridge thread; UI thread waits for bridge to return |
| 2 | PostMessageW(WM_NCLBUTTONDOWN, HTCAPTION, 0) | No drag | WebView2 still has mouse capture; lParam=0 has no valid cursor coords |
| 3 | WM_NCHITTEST returning HTCAPTION | No effect | WebView2 child window receives mouse events, parent WndProc never sees WM_NCHITTEST for client area |

### Accent border removal

| # | Approach | Result | Root Cause |
|---|----------|--------|------------|
| 1 | DwmExtendFrameIntoClientArea({1,1,1,1}) | No effect | Doesn't affect DWM-drawn border |
| 2 | DwmExtendFrameIntoClientArea({-1,-1,-1,-1}) | No effect | Same |
| 3 | DwmSetWindowAttribute(DWMWA_BORDER_COLOR, DWMWA_COLOR_NONE) | No effect | The border is NC area, not just color |
| 4 | WM_NCCALCSIZE with GetWindowRect | Glitchy sizing on snap | GetWindowRect returns OLD position during WM_NCCALCSIZE |

### Icon swap

| # | Approach | Result | Root Cause |
|---|----------|--------|------------|
| 1 | `window.outerWidth >= screen.availWidth` | Unreliable | Doesn't account for taskbar, multi-monitor, or snapped states |
| 2 | `btn.querySelector('i')` for Lucide icon | Returns null after first render | Lucide replaces `<i>` with `<svg>`, selector must be `[data-lucide]` |

### Double-click

| # | Approach | Result | Root Cause |
|---|----------|--------|------------|
| 1 | JS `dblclick` event on title bar | Never fires | Native drag modal loop (from SendMessage WM_NCLBUTTONDOWN) swallows all subsequent mouse events |

## Critical Lessons Learned

1. **WebView2 mouse capture is the core obstacle.** WebView2's child window captures mouse events. Parent WndProc hooks for WM_NCHITTEST don't work for the client area. Must use PostMessage + ReleaseCapture on the UI thread.

2. **WM_NCCALCSIZE timing matters.** During WM_NCCALCSIZE, `GetWindowRect()` returns the OLD window position. Must read proposed rect from NCCALCSIZE_PARAMS BEFORE calling the default handler.

3. **IsZoomed check is required in WM_NCCALCSIZE.** Removing top NC area when maximized causes a gap because Windows oversizes maximized windows to hide the frame. Skip the override when IsZoomed.

4. **SWP_FRAMECHANGED must come AFTER hook installation.** Otherwise the NC recalculation happens before the hook is in place, and the accent line shows on launch.

5. **ctypes callback must be stored in a global.** The WndProc callback (`_wndproc_ref`) will be garbage collected if stored as a local variable, causing a crash.

6. **ctypes.cast for function pointers.** `ctypes.cast(func, ctypes.c_ssize_t)` fails — cast requires a pointer type. Use `ctypes.cast(func, ctypes.c_void_p).value` instead.

7. **Lucide icon rendering.** Lucide replaces `<i data-lucide="...">` with `<svg data-lucide="...">`. Query with `[data-lucide]` attribute selector, not tag name.

8. **Native drag swallows JS events.** Once Windows enters its modal drag loop, no mouse events reach JS. Double-click must be detected via mousedown timing before drag starts.
