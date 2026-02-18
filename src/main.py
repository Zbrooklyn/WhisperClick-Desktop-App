import sys
import os
import threading

# Allow running from project root
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from dotenv import load_dotenv
load_dotenv()

import webview
from PIL import Image, ImageDraw
import pystray
from pynput.keyboard import GlobalHotKeys

from src.backend.api import Api
from src.backend.config import load_settings, CONFIG_DIR
from src.pill_manager import PillManager


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


def create_tray_icon_image(recording=False):
    """Create a simple microphone icon for the system tray."""
    img = Image.new("RGBA", (64, 64), color=(0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    color = "#6366F1" if recording else "#2ecc71"
    # Mic body
    draw.ellipse([20, 8, 44, 36], fill=color)
    draw.rectangle([26, 32, 38, 48], fill=color)
    # Mic stand
    draw.arc([16, 36, 48, 56], start=0, end=180, fill=color, width=3)
    draw.line([32, 56, 32, 62], fill=color, width=3)
    return img


def main():
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
        if window:
            window.evaluate_js("toggleRecording()")

    def tray_settings(icon=None, item=None):
        if window:
            window.show()
            window.restore()
            window.evaluate_js("openSettings()")
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
        icon_image = create_tray_icon_image()
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
    def on_hotkey():
        if window:
            window.evaluate_js("toggleRecording()")

    def setup_hotkey():
        try:
            listener = GlobalHotKeys({"<ctrl>+<shift>+r": on_hotkey})
            listener.daemon = True
            listener.start()
        except Exception:
            pass  # Hotkey registration failed, buttons still work

    # --- Window close handler ---
    def on_closing():
        behavior = api.get_close_behavior()
        if behavior == "quit":
            tray_quit()
            return True
        else:
            if window:
                window.hide()
            show_pill()
            return False

    # Start tray in background thread
    tray_thread = threading.Thread(target=setup_tray, daemon=True)
    tray_thread.start()

    # Start hotkey listener
    setup_hotkey()

    # Get frontend paths
    frontend_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), "frontend")
    html_path = os.path.join(frontend_dir, "index.html")
    # Create main webview window
    window = webview.create_window(
        "WhisperClick",
        html_path,
        js_api=api,
        width=520,
        height=640,
        min_size=(440, 500),
        background_color="#1C1917",
        frameless=True,
        easy_drag=True,
        on_top=settings.get("always_on_top", False),
    )

    # Store window ref in api
    api.set_window(window)

    # Start pill widget if enabled in settings
    if settings.get("show_pill_widget", False):
        pill_manager.start()

    # Handle window closing
    window.events.closing += on_closing

    webview.start(debug=False)


if __name__ == "__main__":
    main()
