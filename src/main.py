import sys
import os
import threading
import time
import json
import ctypes
import ctypes.wintypes as wintypes
from pathlib import Path

# ---------------------------------------------------------------------------
# DPI awareness — MUST be set before importing any UI libraries
# Per-Monitor V2 is the modern standard (Win10 1703+). Falls back gracefully.
# See docs/dpi-drag-fix-spec.md for rationale.
# ---------------------------------------------------------------------------
try:
    # Per-Monitor V2: automatic non-client scaling, child window DPI notifications
    ctypes.windll.user32.SetProcessDpiAwarenessContext(ctypes.c_ssize_t(-4))
except Exception:
    try:
        # Per-Monitor V1 fallback (Win 8.1+)
        ctypes.windll.shcore.SetProcessDpiAwareness(2)
    except Exception:
        try:
            ctypes.windll.user32.SetProcessDPIAware()
        except Exception:
            pass

# Allow running from project root
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from dotenv import load_dotenv
load_dotenv()

import webview
from PIL import Image, ImageDraw
import pystray
# Win32 RegisterHotKey suppresses the key combo so other apps never see it.
# pynput GlobalHotKeys was previously used but it does NOT suppress events.

from src.backend.api import Api
from src.backend.config import load_settings, CONFIG_DIR
from src.pill_manager import PillManager

# ---------------------------------------------------------------------------
# Window position persistence
# ---------------------------------------------------------------------------
_WINDOW_POS_FILE = os.path.join(CONFIG_DIR, "window_pos.json")
_cached_hwnd = None  # set once after window creation


def _load_window_pos():
    """Load saved window position and size, or return None."""
    try:
        with open(_WINDOW_POS_FILE, "r") as f:
            pos = json.load(f)
        if isinstance(pos.get("x"), int) and isinstance(pos.get("y"), int):
            return pos
    except (FileNotFoundError, json.JSONDecodeError, KeyError):
        pass
    return None


def _save_window_pos(x, y, w=None, h=None):
    """Persist window position (and optionally size) to disk."""
    try:
        os.makedirs(CONFIG_DIR, exist_ok=True)
        data = {"x": int(x), "y": int(y)}
        if w is not None and h is not None:
            data["w"] = int(w)
            data["h"] = int(h)
        with open(_WINDOW_POS_FILE, "w") as f:
            json.dump(data, f)
    except Exception:
        pass



def _calc_default_window_size():
    """Calculate default window size as 22% of the primary monitor's effective
    width, clamped to [480, 650] logical pixels.  Height maintains a 1.58
    aspect ratio with a 620px floor.  See docs/window-sizing-spec.md."""
    try:
        # Find primary monitor
        pt = wintypes.POINT(0, 0)
        hmon = ctypes.windll.user32.MonitorFromPoint(pt, 1)

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
        ctypes.windll.user32.GetMonitorInfoW(hmon, ctypes.byref(info))
        r = info.rcMonitor
        phys_w = r.right - r.left

        # Get DPI scale factor
        MDT_EFFECTIVE_DPI = 0
        dpi_x = ctypes.c_uint()
        ctypes.windll.shcore.GetDpiForMonitor(
            hmon, MDT_EFFECTIVE_DPI,
            ctypes.byref(dpi_x), ctypes.byref(ctypes.c_uint()),
        )
        scale = dpi_x.value / 96.0

        effective_w = phys_w / scale
        target_w = int(effective_w * 0.22)
        w = max(480, min(650, target_w))
        h = max(620, int(w * 1.58))
        return w, h
    except Exception:
        return 520, 820  # safe fallback


def _find_hwnd():
    """Find and cache the WhisperClick HWND."""
    global _cached_hwnd
    if _cached_hwnd:
        # Verify it's still valid
        if ctypes.windll.user32.IsWindow(_cached_hwnd):
            return _cached_hwnd
        _cached_hwnd = None
    hwnd = ctypes.windll.user32.FindWindowW(None, "WhisperClick")
    if hwnd:
        _cached_hwnd = hwnd
    return hwnd


def _get_hwnd_pos():
    """Get window position and size via cached HWND."""
    hwnd = _find_hwnd()
    if not hwnd:
        return None
    rect = wintypes.RECT()
    ctypes.windll.user32.GetWindowRect(hwnd, ctypes.byref(rect))
    return {
        "x": rect.left, "y": rect.top,
        "w": rect.right - rect.left, "h": rect.bottom - rect.top,
    }


def _set_hwnd_pos(x, y, w=None, h=None):
    """Set window position (and optionally size) via cached HWND."""
    hwnd = _find_hwnd()
    if not hwnd:
        return
    SWP_NOZORDER = 0x0004
    SWP_NOSIZE = 0x0001
    flags = SWP_NOZORDER
    if w is None or h is None:
        flags |= SWP_NOSIZE
        w, h = 0, 0
    ctypes.windll.user32.SetWindowPos(hwnd, 0, int(x), int(y),
                                       int(w), int(h), flags)


def _is_pos_on_screen(x, y):
    """Check if (x, y) falls within any connected monitor."""
    monitors = []

    def _enum_cb(hMonitor, hdcMonitor, lprcMonitor, dwData):
        r = lprcMonitor.contents
        monitors.append((r.left, r.top, r.right, r.bottom))
        return True

    MONITORENUMPROC = ctypes.WINFUNCTYPE(
        ctypes.c_int, wintypes.HMONITOR, wintypes.HDC,
        ctypes.POINTER(wintypes.RECT), wintypes.LPARAM,
    )
    ctypes.windll.user32.EnumDisplayMonitors(
        None, None, MONITORENUMPROC(_enum_cb), 0
    )
    if not monitors:
        return True  # can't verify, assume ok
    # Consider visible if the top-left corner is within any monitor
    # with a small margin so the title bar is reachable
    for left, top, right, bottom in monitors:
        if left <= x < right - 50 and top <= y < bottom - 50:
            return True
    return False

SRC_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_DIR = os.path.dirname(SRC_DIR)
DEFAULT_HOTKEY = "Ctrl + Alt + R"
APP_USER_MODEL_ID = "com.whisperclick.desktop"
HOTKEY_BRIDGE_COOLDOWN_SEC = 0.2


# ---------------------------------------------------------------------------
# Single-instance guard using a lock file
# ---------------------------------------------------------------------------
_lock_file = None

def _acquire_instance_lock():
    """Ensure only one instance of WhisperClick is running."""
    global _lock_file
    lock_path = os.path.join(CONFIG_DIR, "whisperclick.lock")
    os.makedirs(CONFIG_DIR, exist_ok=True)
    try:
        _lock_file = open(lock_path, "w")
        if sys.platform == "win32":
            import msvcrt
            msvcrt.locking(_lock_file.fileno(), msvcrt.LK_NBLCK, 1)
        else:
            import fcntl
            fcntl.flock(_lock_file, fcntl.LOCK_EX | fcntl.LOCK_NB)
        return True
    except (OSError, IOError):
        return False


def _set_windows_app_id():
    """Set explicit AppUserModelID for stable taskbar icon/grouping on Windows."""
    if sys.platform != "win32":
        return
    try:
        import ctypes
        ctypes.windll.shell32.SetCurrentProcessExplicitAppUserModelID(APP_USER_MODEL_ID)
    except Exception:
        pass


def _runtime_base_dir() -> Path:
    """Return runtime base directory for source and frozen builds."""
    if getattr(sys, "frozen", False) and hasattr(sys, "_MEIPASS"):
        return Path(sys._MEIPASS)
    return Path(PROJECT_DIR)


def _resource_path(*parts: str) -> Path:
    return _runtime_base_dir().joinpath(*parts)


def _resolve_frontend_index() -> Path:
    candidates = [
        _resource_path("src", "frontend", "index.html"),
        _resource_path("frontend", "index.html"),
        Path(SRC_DIR).joinpath("frontend", "index.html"),
    ]
    for candidate in candidates:
        if candidate.exists():
            return candidate
    return candidates[0]


_BLOCKED_HOTKEYS = {
    "ctrl+c", "ctrl+v", "ctrl+x", "ctrl+z", "ctrl+y",
    "ctrl+a", "ctrl+s", "ctrl+p", "ctrl+f",
    "ctrl+w", "ctrl+q", "ctrl+n", "ctrl+t",
    "ctrl+shift+t", "ctrl+tab",
    "alt+f4", "alt+tab",
    "ctrl+alt+delete", "ctrl+shift+esc",
    "ctrl+shift+g", "ctrl+shift+k", "ctrl+shift+d",
    "ctrl+shift+p", "ctrl+shift+i", "ctrl+shift+j",
    "ctrl+shift+c", "ctrl+shift+v",
    "ctrl+l", "ctrl+h", "ctrl+d", "ctrl+b",
    "ctrl+g", "ctrl+k", "ctrl+e",
    "f1", "f2", "f3", "f4", "f5", "f6", "f11",
    "alt+f1", "alt+f2",
}


# ---------------------------------------------------------------------------
# Win32 RegisterHotKey constants and helpers
# ---------------------------------------------------------------------------
_MOD_ALT = 0x0001
_MOD_CONTROL = 0x0002
_MOD_SHIFT = 0x0004
_MOD_WIN = 0x0008
_MOD_NOREPEAT = 0x4000
_WM_HOTKEY = 0x0312
_HOTKEY_ID = 1  # single global hotkey

_VK_MAP = {
    "space": 0x20, "tab": 0x09, "enter": 0x0D, "return": 0x0D,
    "esc": 0x1B, "escape": 0x1B,
    "backspace": 0x08, "delete": 0x2E, "insert": 0x2D,
    "home": 0x24, "end": 0x23,
    "pageup": 0x21, "pagedown": 0x22,
    "up": 0x26, "down": 0x28, "left": 0x25, "right": 0x27,
}
# F1–F24
for _i in range(1, 25):
    _VK_MAP[f"f{_i}"] = 0x70 + (_i - 1)
# A–Z (VK codes are uppercase ASCII)
for _c in range(ord('a'), ord('z') + 1):
    _VK_MAP[chr(_c)] = _c - 32
# 0–9
for _d in range(10):
    _VK_MAP[str(_d)] = 0x30 + _d


def _parse_hotkey_to_win32(hotkey: str):
    """Convert UI hotkey text (e.g. 'Ctrl + Alt + R') to (modifiers, vk) tuple.

    Returns None if the hotkey is blocked or unparseable.
    """
    if not hotkey:
        return None

    normalized_check = hotkey.replace(" ", "").lower()
    if normalized_check in _BLOCKED_HOTKEYS:
        return None

    modifier_names = {
        "ctrl": _MOD_CONTROL, "control": _MOD_CONTROL,
        "alt": _MOD_ALT, "shift": _MOD_SHIFT,
        "win": _MOD_WIN, "meta": _MOD_WIN, "cmd": _MOD_WIN,
    }

    tokens = [t for t in hotkey.replace(" ", "").split("+") if t]
    if not tokens:
        return None

    mods = _MOD_NOREPEAT  # prevent repeated WM_HOTKEY while held
    vk = None
    for token in tokens:
        low = token.lower()
        mod_val = modifier_names.get(low)
        if mod_val:
            mods |= mod_val
            continue
        vk_val = _VK_MAP.get(low)
        if vk_val:
            vk = vk_val
            continue
        # Unknown token
        return None

    if vk is None:
        return None
    return (mods, vk)


class Win32HotkeyListener:
    """Global hotkey using RegisterHotKey — suppresses key combo from other apps."""

    def __init__(self, callback):
        self._callback = callback
        self._thread = None
        self._thread_id = None
        self._registered = False

    def bind(self, hotkey_text):
        """Parse hotkey_text, register with Windows, start message pump."""
        self.stop()
        parsed = _parse_hotkey_to_win32(hotkey_text)
        if parsed is None:
            # Fall back to default
            parsed = _parse_hotkey_to_win32(DEFAULT_HOTKEY)
        if parsed is None:
            return False
        mods, vk = parsed

        # Retry loop — Windows may need a moment after UnregisterHotKey
        # before the same combo can be re-registered.
        max_attempts = 3
        for attempt in range(max_attempts):
            ready_event = threading.Event()
            stopped_event = threading.Event()
            success_flag = [False]

            def _pump(re=ready_event, se=stopped_event, sf=success_flag):
                self._thread_id = ctypes.windll.kernel32.GetCurrentThreadId()
                result = ctypes.windll.user32.RegisterHotKey(None, _HOTKEY_ID, mods, vk)
                sf[0] = bool(result)
                self._registered = bool(result)
                re.set()
                if not result:
                    se.set()
                    return

                msg = wintypes.MSG()
                while ctypes.windll.user32.GetMessageW(ctypes.byref(msg), None, 0, 0) != 0:
                    if msg.message == _WM_HOTKEY:
                        try:
                            self._callback()
                        except Exception:
                            pass
                ctypes.windll.user32.UnregisterHotKey(None, _HOTKEY_ID)
                self._registered = False
                se.set()

            self._stopped_event = stopped_event
            self._thread = threading.Thread(target=_pump, daemon=True)
            self._thread.start()
            ready_event.wait(timeout=2)
            if success_flag[0]:
                return True
            # Registration failed — clean up thread before retrying
            self._thread.join(timeout=1)
            self._thread = None
            self._thread_id = None
            if attempt < max_attempts - 1:
                time.sleep(0.05)
        return False

    def stop(self):
        """Unregister hotkey and stop message pump."""
        tid = self._thread_id
        if tid and self._thread and self._thread.is_alive():
            # Post WM_QUIT to break GetMessageW loop
            ctypes.windll.user32.PostThreadMessageW(tid, 0x0012, 0, 0)  # WM_QUIT
            # Wait for UnregisterHotKey to complete inside the pump thread
            stopped = getattr(self, '_stopped_event', None)
            if stopped:
                stopped.wait(timeout=2)
            self._thread.join(timeout=1)
            # Brief delay for Windows to fully release the registration
            time.sleep(0.02)
        self._thread = None
        self._thread_id = None


def create_tray_icon_image(recording=False):
    """Create a simple microphone icon for the system tray."""
    img = Image.new("RGBA", (64, 64), color=(0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    color = "#ef4444" if recording else "#CF9673"
    # Mic body
    draw.ellipse([20, 8, 44, 36], fill=color)
    draw.rectangle([26, 32, 38, 48], fill=color)
    # Mic stand
    draw.arc([16, 36, 48, 56], start=0, end=180, fill=color, width=3)
    draw.line([32, 56, 32, 62], fill=color, width=3)
    return img


def load_tray_icon_image(recording=False):
    """Load branded tray icon from assets, with fallback to generated icon."""
    candidates = [
        _resource_path("assets", "microphone_logo.ico"),
        _resource_path("assets", "microphone_logo.png"),
        Path(PROJECT_DIR).joinpath("assets", "microphone_logo.ico"),
        Path(PROJECT_DIR).joinpath("assets", "microphone_logo.png"),
    ]
    icon_path = next((p for p in candidates if p.exists()), None)
    if icon_path:
        try:
            base = Image.open(icon_path).convert("RGBA")
            base = base.resize((64, 64), Image.Resampling.LANCZOS)
            if not recording:
                return base
            icon = base.copy()
            draw = ImageDraw.Draw(icon)
            draw.ellipse([44, 44, 60, 60], fill="#ef4444", outline=(255, 255, 255, 220), width=2)
            return icon
        except Exception:
            pass
    return create_tray_icon_image(recording=recording)


def main():
    _set_windows_app_id()

    if not _acquire_instance_lock():
        # Another instance is already running
        try:
            import ctypes
            ctypes.windll.user32.MessageBoxW(
                0, "WhisperClick is already running.\nCheck the system tray.",
                "WhisperClick", 0x40,
            )
        except Exception:
            print("WhisperClick is already running.")
        sys.exit(0)

    api = Api()
    settings = load_settings()

    # Shared state
    window = None
    tray_icon = None
    hotkey_listener = Win32HotkeyListener(lambda: None)  # placeholder callback
    hotkey_lock = threading.Lock()
    hotkey_dispatch_lock = threading.Lock()
    hotkey_dispatch_inflight = False
    last_hotkey_dispatch_at = 0.0

    # --- Pill manager ---
    pill_manager = PillManager(api)
    api.set_pill_manager(pill_manager)

    def show_pill():
        pill_manager.show()

    def hide_pill():
        pill_manager.hide()

    # --- System tray ---
    def tray_show(icon=None, item=None):
        if window:
            window.show()
            window.restore()
        hide_pill()

    def tray_record(icon=None, item=None):
        request_hotkey_toggle()

    def tray_settings(icon=None, item=None):
        if window:
            window.show()
            window.restore()
            window.evaluate_js("openSettingsDrawer()")
        hide_pill()

    def tray_quit(icon=None, item=None):
        pill_manager.shutdown()
        if tray_icon:
            tray_icon.stop()
        if window:
            window.destroy()
        # Failsafe: force exit if webview doesn't shut down cleanly
        def _force_exit():
            import time
            time.sleep(2)
            os._exit(0)
        threading.Thread(target=_force_exit, daemon=True).start()

    def setup_tray():
        nonlocal tray_icon
        icon_image = load_tray_icon_image()
        menu = pystray.Menu(
            pystray.MenuItem("Show", tray_show, default=True),
            pystray.MenuItem("Record", tray_record),
            pystray.MenuItem("Settings", tray_settings),
            pystray.Menu.SEPARATOR,
            pystray.MenuItem("Quit", tray_quit),
        )
        tray_icon = pystray.Icon("whisperclick", icon_image, "WhisperClick", menu)
        tray_icon.run()

    # --- Global hotkey ---
    def dispatch_hotkey_toggle():
        if not window:
            return
        # Capture the foreground window *before* triggering the toggle,
        # so auto-paste knows where to Ctrl+V after transcription.
        api.capture_paste_target()
        try:
            window.evaluate_js("triggerTrustedHotkeyToggle()")
        except Exception:
            # Keep listener alive even if JS bridge is temporarily unavailable.
            pass

    def request_hotkey_toggle():
        nonlocal hotkey_dispatch_inflight, last_hotkey_dispatch_at

        with hotkey_dispatch_lock:
            now = time.monotonic()
            if hotkey_dispatch_inflight:
                return
            if now - last_hotkey_dispatch_at < HOTKEY_BRIDGE_COOLDOWN_SEC:
                return
            hotkey_dispatch_inflight = True
            last_hotkey_dispatch_at = now

        def _run():
            nonlocal hotkey_dispatch_inflight
            try:
                dispatch_hotkey_toggle()
            finally:
                with hotkey_dispatch_lock:
                    hotkey_dispatch_inflight = False

        threading.Thread(target=_run, daemon=True).start()

    def on_hotkey():
        request_hotkey_toggle()

    def apply_hotkey_binding(hotkey_text=None):
        nonlocal hotkey_listener
        hotkey_display = hotkey_text if hotkey_text else settings.get("hotkey")

        with hotkey_lock:
            hotkey_listener.stop()
            hotkey_listener = Win32HotkeyListener(on_hotkey)
            success = hotkey_listener.bind(hotkey_display)
            if success:
                if hotkey_text:
                    settings["hotkey"] = hotkey_text
                return {"success": True, "binding": hotkey_display}
            else:
                return {"success": False, "binding": hotkey_display,
                        "error": "Could not register hotkey (may be in use by another app)"}

    # --- Window close handler ---
    def on_closing():
        # Save window position before closing/hiding
        try:
            pos = _get_hwnd_pos()
            if pos:
                _save_window_pos(pos["x"], pos["y"], pos["w"], pos["h"])
        except Exception:
            pass

        behavior = api.get_close_behavior()
        if behavior == "quit":
            tray_quit()
            return True
        else:
            if window:
                window.hide()
            try:
                if api.get_settings().get("show_pill_widget", False):
                    show_pill()
                else:
                    hide_pill()
            except Exception:
                hide_pill()
            return False

    # Start tray in background thread
    tray_thread = threading.Thread(target=setup_tray, daemon=True)
    tray_thread.start()

    # Start hotkey listener
    apply_hotkey_binding(settings.get("hotkey"))
    api.set_hotkey_updater(apply_hotkey_binding)

    # Get frontend paths
    html_path = _resolve_frontend_index()
    if not html_path.exists():
        msg = f"Frontend file not found: {html_path}"
        try:
            import ctypes
            ctypes.windll.user32.MessageBoxW(0, msg, "WhisperClick Error", 0x10)
        except Exception:
            print(msg)
        sys.exit(1)

    window_url = html_path.resolve().as_uri()

    saved_pos = _load_window_pos()
    default_w, default_h = _calc_default_window_size()

    # Create main webview window (pywebview handles DPI scaling of defaults)
    win_kwargs = dict(
        title="WhisperClick",
        url=window_url,
        js_api=api,
        width=default_w,
        height=default_h,
        min_size=(480, 620),
        resizable=True,
        background_color="#1C1917",
        frameless=True,
        easy_drag=False,
        on_top=settings.get("always_on_top", False),
    )
    window = webview.create_window(**win_kwargs)

    # Store window ref in api
    api.set_window(window)

    # Start pill widget if enabled in settings
    if settings.get("show_pill_widget", False):
        pill_manager.start()

    # Handle window closing
    window.events.closing += on_closing

    def _on_webview_started():
        """Called once the webview window is fully created and visible."""

        def _restore_and_save():
            # 1. Wait for HWND to become available (up to 5 seconds)
            hwnd = None
            for attempt in range(50):
                hwnd = _find_hwnd()
                if hwnd:
                    break
                time.sleep(0.1)

            if hwnd and saved_pos:
                if _is_pos_on_screen(saved_pos["x"], saved_pos["y"]):
                    _set_hwnd_pos(
                        saved_pos["x"], saved_pos["y"],
                        saved_pos.get("w"), saved_pos.get("h"),
                    )

            # 3. Start periodic position+size saver (survives force-kill)
            last_state = None
            while True:
                time.sleep(3)
                try:
                    pos = _get_hwnd_pos()
                    if pos:
                        state = (pos["x"], pos["y"], pos["w"], pos["h"])
                        if state != last_state:
                            _save_window_pos(*state)
                            last_state = state
                except Exception:
                    pass

        threading.Thread(target=_restore_and_save, daemon=True).start()

    webview.start(func=_on_webview_started, debug=False)


if __name__ == "__main__":
    main()
