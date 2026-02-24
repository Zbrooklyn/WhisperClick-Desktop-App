import ctypes
import ctypes.wintypes as wintypes
import json
import os
import sys
import threading
import time
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
            pass  # DPI: all methods unavailable — accept system default

# Allow running from project root
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from dotenv import load_dotenv

load_dotenv()

import pystray
import webview
from PIL import Image, ImageDraw

# Win32 RegisterHotKey suppresses the key combo so other apps never see it.
# pynput GlobalHotKeys was previously used but it does NOT suppress events.
from src.backend.api import Api
from src.backend.config import CONFIG_DIR, load_settings
from src.backend.logger import get as get_logger
from src.pill_manager import PillManager

_log = get_logger("main")

# ---------------------------------------------------------------------------
# Window position persistence
# ---------------------------------------------------------------------------
_WINDOW_POS_FILE = os.path.join(CONFIG_DIR, "window_pos.json")
_cached_hwnd = None  # set once after window creation


def _load_window_pos():
    """Load saved window position and size, or return None."""
    try:
        with open(_WINDOW_POS_FILE) as f:
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
        _log.warning("Failed to save window position", exc_info=True)


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
            hmon,
            MDT_EFFECTIVE_DPI,
            ctypes.byref(dpi_x),
            ctypes.byref(ctypes.c_uint()),
        )
        scale = dpi_x.value / 96.0

        effective_w = phys_w / scale
        target_w = int(effective_w * 0.22)
        w = max(480, min(650, target_w))
        h = max(620, int(w * 1.58))
        return w, h
    except Exception:
        _log.warning("DPI-aware window sizing failed, using fallback", exc_info=True)
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
        "x": rect.left,
        "y": rect.top,
        "w": rect.right - rect.left,
        "h": rect.bottom - rect.top,
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
    ctypes.windll.user32.SetWindowPos(hwnd, 0, int(x), int(y), int(w), int(h), flags)


def _is_pos_on_screen(x, y):
    """Check if (x, y) falls within any connected monitor."""
    monitors = []

    def _enum_cb(hMonitor, hdcMonitor, lprcMonitor, dwData):
        r = lprcMonitor.contents
        monitors.append((r.left, r.top, r.right, r.bottom))
        return True

    MONITORENUMPROC = ctypes.WINFUNCTYPE(
        ctypes.c_int,
        wintypes.HMONITOR,
        wintypes.HDC,
        ctypes.POINTER(wintypes.RECT),
        wintypes.LPARAM,
    )
    ctypes.windll.user32.EnumDisplayMonitors(None, None, MONITORENUMPROC(_enum_cb), 0)
    if not monitors:
        return True  # can't verify, assume ok
    # Consider visible if the top-left corner is within any monitor
    # with a small margin so the title bar is reachable
    return any(left <= x < right - 50 and top <= y < bottom - 50 for left, top, right, bottom in monitors)


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
    except OSError:
        return False


def _set_windows_app_id():
    """Set explicit AppUserModelID for stable taskbar icon/grouping on Windows."""
    if sys.platform != "win32":
        return
    try:
        import ctypes

        ctypes.windll.shell32.SetCurrentProcessExplicitAppUserModelID(APP_USER_MODEL_ID)
    except Exception:
        _log.warning("Failed to set AppUserModelID", exc_info=True)


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
    "ctrl+c",
    "ctrl+v",
    "ctrl+x",
    "ctrl+z",
    "ctrl+y",
    "ctrl+a",
    "ctrl+s",
    "ctrl+p",
    "ctrl+f",
    "ctrl+w",
    "ctrl+q",
    "ctrl+n",
    "ctrl+t",
    "ctrl+shift+t",
    "ctrl+tab",
    "alt+f4",
    "alt+tab",
    "ctrl+alt+delete",
    "ctrl+shift+esc",
    "ctrl+shift+g",
    "ctrl+shift+k",
    "ctrl+shift+d",
    "ctrl+shift+p",
    "ctrl+shift+i",
    "ctrl+shift+j",
    "ctrl+shift+c",
    "ctrl+shift+v",
    "ctrl+l",
    "ctrl+h",
    "ctrl+d",
    "ctrl+b",
    "ctrl+g",
    "ctrl+k",
    "ctrl+e",
    "f1",
    "f2",
    "f3",
    "f4",
    "f5",
    "f6",
    "f11",
    "alt+f1",
    "alt+f2",
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
    "space": 0x20,
    "tab": 0x09,
    "enter": 0x0D,
    "return": 0x0D,
    "esc": 0x1B,
    "escape": 0x1B,
    "backspace": 0x08,
    "delete": 0x2E,
    "insert": 0x2D,
    "home": 0x24,
    "end": 0x23,
    "pageup": 0x21,
    "pagedown": 0x22,
    "up": 0x26,
    "down": 0x28,
    "left": 0x25,
    "right": 0x27,
}
# Punctuation / symbol keys (OEM keys, US keyboard layout)
# Both base and shifted characters map to the same VK code.
_VK_MAP.update(
    {
        ";": 0xBA,
        ":": 0xBA,  # VK_OEM_1 (;: key)
        "=": 0xBB,  # VK_OEM_PLUS (=+ key, base)
        ",": 0xBC,
        "<": 0xBC,  # VK_OEM_COMMA
        "-": 0xBD,
        "_": 0xBD,  # VK_OEM_MINUS
        ".": 0xBE,
        ">": 0xBE,  # VK_OEM_PERIOD
        "/": 0xBF,
        "?": 0xBF,  # VK_OEM_2
        "`": 0xC0,
        "~": 0xC0,  # VK_OEM_3
        "[": 0xDB,
        "{": 0xDB,  # VK_OEM_4
        "\\": 0xDC,
        "|": 0xDC,  # VK_OEM_5
        "]": 0xDD,
        "}": 0xDD,  # VK_OEM_6
        "'": 0xDE,
        '"': 0xDE,  # VK_OEM_7
    }
)
# F1-F24
for _i in range(1, 25):
    _VK_MAP[f"f{_i}"] = 0x70 + (_i - 1)
# A-Z (VK codes are uppercase ASCII)
for _c in range(ord("a"), ord("z") + 1):
    _VK_MAP[chr(_c)] = _c - 32
# 0-9
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
        "ctrl": _MOD_CONTROL,
        "control": _MOD_CONTROL,
        "alt": _MOD_ALT,
        "shift": _MOD_SHIFT,
        "win": _MOD_WIN,
        "meta": _MOD_WIN,
        "cmd": _MOD_WIN,
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
                            _log.error("Hotkey callback failed", exc_info=True)
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
            stopped = getattr(self, "_stopped_event", None)
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
            _log.warning("Failed to load branded tray icon, using generated", exc_info=True)
    return create_tray_icon_image(recording=recording)


def main():
    _set_windows_app_id()

    if not _acquire_instance_lock():
        # Another instance is already running
        try:
            import ctypes

            ctypes.windll.user32.MessageBoxW(
                0,
                "WhisperClick is already running.\nCheck the system tray.",
                "WhisperClick",
                0x40,
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
        _log.info("Shutdown initiated")

        # 1. Stop hotkey listener
        try:
            with hotkey_lock:
                hotkey_listener.stop()
        except Exception:
            _log.debug("Hotkey listener stop failed during shutdown", exc_info=True)

        # 2. Stop pill widget
        try:
            pill_manager.shutdown()
        except Exception:
            _log.debug("Pill manager shutdown failed", exc_info=True)

        # 3. Stop tray icon
        try:
            if tray_icon:
                tray_icon.stop()
        except Exception:
            _log.debug("Tray icon stop failed during shutdown", exc_info=True)

        # 4. Save window position
        try:
            pos = _get_hwnd_pos()
            if pos:
                _save_window_pos(pos["x"], pos["y"], pos["w"], pos["h"])
        except Exception:
            _log.debug("Window pos save failed during shutdown", exc_info=True)

        # 5. Close audio streams
        try:
            if api._recorder.is_recording():
                api._recorder.stop()
        except Exception:
            _log.debug("Audio recorder stop failed during shutdown", exc_info=True)

        # 6. Destroy webview window
        try:
            if window:
                window.destroy()
        except Exception:
            _log.debug("Window destroy failed during shutdown", exc_info=True)

        # 7. Wait briefly for threads, then force exit as last resort
        def _force_exit():
            time.sleep(3)
            _log.info("Force exit — threads did not finish in time")
            os._exit(0)

        threading.Thread(target=_force_exit, daemon=True).start()

    # --- Tray menu action handlers ---
    def tray_sound_toggle(icon=None, item=None):
        enabled = not api._settings.get("sound_enabled", True)
        api.save_settings({"sound_enabled": enabled})

    def tray_mode_toggle(icon=None, item=None):
        current = api._settings.get("mode", "local")
        api.save_settings({"mode": "api" if current == "local" else "local"})

    def tray_paste_last(icon=None, item=None):
        api.paste_last_transcript()

    def tray_select_mic(mic_id):
        def _handler(icon=None, item=None):
            api.set_microphone(mic_id)
            api.save_settings({"microphone": mic_id})

        return _handler

    def tray_copy_history(text):
        def _handler(icon=None, item=None):
            api.copy_to_clipboard(text)

        return _handler

    def _build_tray_menu_items():
        """Build dynamic tray menu items (called each time the menu opens)."""
        from src.backend.config import load_history as _load_hist

        s = api._settings
        items = []

        # 1. Record / Stop / Processing
        rec_state = api.get_recording_state()
        if rec_state.get("is_recording"):
            items.append(pystray.MenuItem("Stop Recording", tray_record))
        elif rec_state.get("is_processing"):
            items.append(pystray.MenuItem("Processing\u2026", None, enabled=False))
        else:
            items.append(pystray.MenuItem("Record", tray_record))

        items.append(pystray.Menu.SEPARATOR)

        # 3. Microphone submenu
        mics = api.get_microphones()
        mic_items = []
        if mics:
            for mic in mics:
                mid = mic["id"]
                mic_items.append(
                    pystray.MenuItem(
                        mic["name"],
                        tray_select_mic(mid),
                        checked=lambda item, m=mid: m == api._settings.get("microphone", -1),
                    )
                )
        else:
            mic_items.append(pystray.MenuItem("No microphones", None, enabled=False))
        items.append(pystray.MenuItem("Microphone", pystray.Menu(*mic_items)))

        # 4. Sound Effects toggle
        items.append(
            pystray.MenuItem(
                "Sound Effects",
                tray_sound_toggle,
                checked=lambda item: api._settings.get("sound_enabled", True),
            )
        )

        # 5. Mode toggle
        mode = s.get("mode", "local")
        mode_label = "Local" if mode == "local" else "API"
        items.append(pystray.MenuItem(f"Mode: {mode_label}", tray_mode_toggle))

        items.append(pystray.Menu.SEPARATOR)

        # 7. Recent Transcriptions submenu
        history = _load_hist()
        if history:
            hist_items = []
            for entry in history[:10]:
                text = entry.get("text", "")
                disp = (text[:40] + "\u2026") if len(text) > 40 else (text or "(empty)")
                hist_items.append(pystray.MenuItem(disp, tray_copy_history(text)))
            items.append(pystray.MenuItem("Recent Transcriptions", pystray.Menu(*hist_items)))

        # 8. Paste Last Transcript
        items.append(pystray.MenuItem("Paste Last Transcript", tray_paste_last))

        items.append(pystray.Menu.SEPARATOR)

        # 10. Show WhisperClick (default action)
        items.append(pystray.MenuItem("Show WhisperClick", tray_show, default=True))

        # 11. Settings
        items.append(pystray.MenuItem("Settings", tray_settings))

        items.append(pystray.Menu.SEPARATOR)

        # 13. Hotkey reminder
        hotkey_label = s.get("hotkey", "Ctrl + Alt + R")
        items.append(pystray.MenuItem(hotkey_label, None, enabled=False))

        # 15. Quit
        items.append(pystray.MenuItem("Quit", tray_quit))

        return items

    def setup_tray():
        nonlocal tray_icon
        icon_image = load_tray_icon_image()
        menu = pystray.Menu(lambda: _build_tray_menu_items())
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
            _log.warning("Hotkey JS bridge call failed", exc_info=True)

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

        # Validate before disrupting the current binding
        if _parse_hotkey_to_win32(hotkey_display) is None:
            _log.warning("Hotkey '%s' could not be parsed — keeping current binding", hotkey_display)
            return {
                "success": False,
                "binding": hotkey_display,
                "error": f"Unsupported hotkey: {hotkey_display}",
            }

        with hotkey_lock:
            hotkey_listener.stop()
            hotkey_listener = Win32HotkeyListener(on_hotkey)
            success = hotkey_listener.bind(hotkey_display)
            if success:
                if hotkey_text:
                    settings["hotkey"] = hotkey_text
                return {"success": True, "binding": hotkey_display}
            else:
                return {
                    "success": False,
                    "binding": hotkey_display,
                    "error": "Could not register hotkey (may be in use by another app)",
                }

    # --- Window close handler ---
    def on_closing():
        # Save window position before closing/hiding
        try:
            pos = _get_hwnd_pos()
            if pos:
                _save_window_pos(pos["x"], pos["y"], pos["w"], pos["h"])
        except Exception:
            _log.warning("Failed to save window pos on close", exc_info=True)

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
                _log.warning("Pill widget toggle on close failed", exc_info=True)
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
            for _attempt in range(50):
                hwnd = _find_hwnd()
                if hwnd:
                    break
                time.sleep(0.1)

            if hwnd and saved_pos and _is_pos_on_screen(saved_pos["x"], saved_pos["y"]):
                _set_hwnd_pos(
                    saved_pos["x"],
                    saved_pos["y"],
                    saved_pos.get("w"),
                    saved_pos.get("h"),
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
                    _log.debug("Periodic window pos save failed", exc_info=True)

        threading.Thread(target=_restore_and_save, daemon=True).start()

    webview.start(func=_on_webview_started, debug=False)


if __name__ == "__main__":
    main()
