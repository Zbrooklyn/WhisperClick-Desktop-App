"""
Standalone drag test window.
Tests the Win32 GetCursorPos/GetWindowRect approach for frameless window dragging.
This bypasses all CSS-to-physical coordinate conversion — no DPI math needed.

Usage:
    python tools/drag_test.py

Test on BOTH monitors to verify drag works correctly across different DPI scales.
"""

import ctypes
import ctypes.wintypes as wintypes
import os
import sys

# DPI awareness — same as main app
try:
    ctypes.windll.user32.SetProcessDpiAwarenessContext(ctypes.c_ssize_t(-4))
except Exception:
    try:
        ctypes.windll.shcore.SetProcessDpiAwareness(2)
    except Exception:
        pass

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


import webview

_drag_state = {}


class DragTestApi:
    def drag_start(self):
        """Called on mousedown in drag region. Stores physical positions."""
        cursor = wintypes.POINT()
        ctypes.windll.user32.GetCursorPos(ctypes.byref(cursor))

        hwnd = ctypes.windll.user32.FindWindowW(None, "Drag Test")
        if not hwnd:
            return
        rect = wintypes.RECT()
        ctypes.windll.user32.GetWindowRect(hwnd, ctypes.byref(rect))

        _drag_state["cursor_x"] = cursor.x
        _drag_state["cursor_y"] = cursor.y
        _drag_state["win_x"] = rect.left
        _drag_state["win_y"] = rect.top
        _drag_state["hwnd"] = hwnd
        _drag_state["active"] = True

    def drag_move(self):
        """Called on mousemove during drag. Uses physical pixel deltas."""
        if not _drag_state.get("active"):
            return
        cursor = wintypes.POINT()
        ctypes.windll.user32.GetCursorPos(ctypes.byref(cursor))

        dx = cursor.x - _drag_state["cursor_x"]
        dy = cursor.y - _drag_state["cursor_y"]

        new_x = _drag_state["win_x"] + dx
        new_y = _drag_state["win_y"] + dy

        SWP_NOSIZE = 0x0001
        SWP_NOZORDER = 0x0004
        SWP_NOACTIVATE = 0x0010
        ctypes.windll.user32.SetWindowPos(
            _drag_state["hwnd"], 0, new_x, new_y, 0, 0, SWP_NOSIZE | SWP_NOZORDER | SWP_NOACTIVATE
        )

    def drag_end(self):
        """Called on mouseup."""
        _drag_state["active"] = False

    def get_monitor_info(self):
        """Return info about all monitors for diagnostic display."""
        monitors = []

        def _enum_cb(hMonitor, hdcMonitor, lprcMonitor, dwData):
            r = lprcMonitor.contents

            class MONITORINFOEXW(ctypes.Structure):
                _fields_ = [
                    ("cbSize", wintypes.DWORD),
                    ("rcMonitor", wintypes.RECT),
                    ("rcWork", wintypes.RECT),
                    ("dwFlags", wintypes.DWORD),
                    ("szDevice", wintypes.WCHAR * 32),
                ]

            info = MONITORINFOEXW()
            info.cbSize = ctypes.sizeof(MONITORINFOEXW)
            ctypes.windll.user32.GetMonitorInfoW(hMonitor, ctypes.byref(info))

            # Get DPI
            dpi_x = ctypes.c_uint()
            dpi_y = ctypes.c_uint()
            try:
                ctypes.windll.shcore.GetDpiForMonitor(hMonitor, 0, ctypes.byref(dpi_x), ctypes.byref(dpi_y))
            except Exception:
                dpi_x.value = 96

            is_primary = bool(info.dwFlags & 1)
            monitors.append(
                {
                    "name": info.szDevice.rstrip("\x00"),
                    "primary": is_primary,
                    "dpi": dpi_x.value,
                    "scale": f"{dpi_x.value / 96 * 100:.0f}%",
                    "physical": f"{r.right - r.left}x{r.bottom - r.top}",
                    "position": f"({r.left}, {r.top})",
                }
            )
            return True

        MONITORENUMPROC = ctypes.WINFUNCTYPE(
            ctypes.c_int,
            wintypes.HMONITOR,
            wintypes.HDC,
            ctypes.POINTER(wintypes.RECT),
            wintypes.LPARAM,
        )
        ctypes.windll.user32.EnumDisplayMonitors(None, None, MONITORENUMPROC(_enum_cb), 0)
        return monitors


HTML = """
<!DOCTYPE html>
<html>
<head>
<style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { background: #1C1917; color: #e7e5e4; font-family: system-ui; overflow: hidden; }

    #title-bar {
        height: 48px;
        background: #292524;
        display: flex;
        align-items: center;
        padding: 0 16px;
        cursor: default;
        user-select: none;
        -webkit-user-select: none;
    }
    #title-bar .title { font-weight: 600; font-size: 14px; }
    #close-btn {
        margin-left: auto;
        background: none;
        border: none;
        color: #a8a29e;
        font-size: 18px;
        cursor: pointer;
        padding: 4px 8px;
        border-radius: 4px;
    }
    #close-btn:hover { background: #ef4444; color: white; }

    #content {
        padding: 20px;
        font-size: 13px;
        line-height: 1.6;
    }
    .label { color: #a8a29e; font-size: 11px; text-transform: uppercase; margin-top: 12px; }
    .value { color: #e7e5e4; }
    .monitor { background: #292524; border-radius: 8px; padding: 12px; margin: 8px 0; }
    .monitor.primary { border-left: 3px solid #22c55e; }
    .status { margin-top: 16px; padding: 12px; background: #292524; border-radius: 8px; }
    .status.ok { border-left: 3px solid #22c55e; }
    .status.dragging { border-left: 3px solid #3b82f6; }
    #pos-display { font-family: monospace; font-size: 12px; color: #a8a29e; margin-top: 8px; }
</style>
</head>
<body>
    <div id="title-bar">
        <span class="title">Drag Test Window</span>
        <button id="close-btn" onclick="window.pywebview.api.drag_end(); window.close();">&#x2715;</button>
    </div>
    <div id="content">
        <div class="label">Instructions</div>
        <div class="value">Drag this window by the dark title bar. Test on BOTH monitors.</div>

        <div class="label" style="margin-top:16px">Monitors</div>
        <div id="monitors">Loading...</div>

        <div id="drag-status" class="status ok">
            <strong>Status:</strong> <span id="status-text">Ready — drag the title bar</span>
        </div>
        <div id="pos-display"></div>
    </div>

<script>
    let dragging = false;

    const titleBar = document.getElementById('title-bar');
    const statusEl = document.getElementById('drag-status');
    const statusText = document.getElementById('status-text');
    const posDisplay = document.getElementById('pos-display');

    titleBar.addEventListener('mousedown', (e) => {
        if (e.target.closest('button')) return;
        dragging = true;
        window.pywebview.api.drag_start();
        statusEl.className = 'status dragging';
        statusText.textContent = 'Dragging...';
        e.preventDefault();
    });

    window.addEventListener('mousemove', (e) => {
        if (!dragging) return;
        window.pywebview.api.drag_move();
        posDisplay.textContent = `CSS cursor: (${e.screenX}, ${e.screenY}) | window: (${window.screenX}, ${window.screenY})`;
    });

    window.addEventListener('mouseup', () => {
        if (dragging) {
            dragging = false;
            window.pywebview.api.drag_end();
            statusEl.className = 'status ok';
            statusText.textContent = 'Drag complete — window positioned correctly';
        }
    });

    // Load monitor info
    async function loadMonitors() {
        try {
            const monitors = await window.pywebview.api.get_monitor_info();
            let html = '';
            for (const m of monitors) {
                html += `<div class="monitor ${m.primary ? 'primary' : ''}">
                    <strong>${m.name}</strong> ${m.primary ? '(Primary)' : ''}
                    <br>Resolution: ${m.physical} | DPI: ${m.dpi} (${m.scale}) | Position: ${m.position}
                </div>`;
            }
            document.getElementById('monitors').innerHTML = html;
        } catch(e) {
            document.getElementById('monitors').textContent = 'Error: ' + e;
        }
    }

    // Wait for pywebview API
    if (window.pywebview && window.pywebview.api) {
        loadMonitors();
    } else {
        window.addEventListener('pywebviewready', loadMonitors);
    }
</script>
</body>
</html>
"""


def main():
    import tempfile

    # Write HTML to temp file
    tmp = tempfile.NamedTemporaryFile(suffix=".html", delete=False, mode="w", encoding="utf-8")
    tmp.write(HTML)
    tmp.close()

    api = DragTestApi()
    webview.create_window(
        title="Drag Test",
        url=tmp.name,
        js_api=api,
        width=420,
        height=480,
        resizable=True,
        frameless=True,
        easy_drag=False,
    )
    webview.start(debug=False)

    # Cleanup
    try:
        os.unlink(tmp.name)
    except Exception:
        pass


if __name__ == "__main__":
    main()
