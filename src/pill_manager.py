"""PillManager — runs the Qt pill widget in a background thread and bridges
its signals to the Api layer.
"""

import sys
import threading

from PySide6.QtWidgets import QApplication
from PySide6.QtCore import QObject, QTimer, Signal

from src.pill_widget import PillWidget
from src.backend.tones import play_cancel_tone


class _Invoker(QObject):
    """Thread-safe bridge for posting callables to the Qt event loop."""
    _signal = Signal(object)

    def __init__(self):
        super().__init__()
        self._signal.connect(self._run)

    def _run(self, fn):
        fn()

    def invoke(self, fn):
        """Schedule *fn* to run on the Qt thread."""
        self._signal.emit(fn)


class PillManager:
    """Runs Qt pill widget in a background thread, bridges to Api."""

    def __init__(self, api):
        self._api = api
        self._pill = None
        self._qt_thread = None
        self._level_timer = None
        self._app = None
        self._invoker = None
        self._started = False
        self._transcription_gen = 0

    # ------------------------------------------------------------------
    # Public — callable from any thread
    # ------------------------------------------------------------------

    def start(self):
        """Start the Qt event loop thread (idempotent). Pill starts hidden."""
        if not self._started:
            self._started = True
            self._qt_thread = threading.Thread(target=self._run_qt, daemon=True)
            self._qt_thread.start()

    def stop(self):
        """Hide the pill widget (keeps Qt thread alive)."""
        self.hide()

    def show(self):
        """Show the pill widget (thread-safe)."""
        if self._invoker and self._pill:
            self._invoker.invoke(self._pill.show)

    def hide(self):
        """Hide the pill widget (thread-safe)."""
        if self._invoker and self._pill:
            self._invoker.invoke(self._pill.hide)

    def shutdown(self):
        """Quit the Qt event loop for clean exit."""
        if self._invoker and self._app:
            self._invoker.invoke(self._app.quit)

    # ------------------------------------------------------------------
    # Qt thread
    # ------------------------------------------------------------------

    def _run_qt(self):
        self._app = QApplication.instance() or QApplication(sys.argv)
        self._invoker = _Invoker()
        self._pill = PillWidget()

        # Core signals
        self._pill.record_requested.connect(self._on_record)
        self._pill.stop_requested.connect(self._on_stop)
        self._pill.cancel_requested.connect(self._on_cancel)
        self._pill.show_main_requested.connect(self._on_show_main)
        self._pill.open_settings_requested.connect(self._on_open_settings)
        self._pill.hide_requested.connect(self._on_hide)
        self._pill.paste_last_requested.connect(self._on_paste_last)

        # Enhanced menu signals
        self._pill.sound_toggled.connect(self._on_sound_toggle)
        self._pill.mic_selected.connect(self._on_mic_select)
        self._pill.mode_toggled.connect(self._on_mode_toggle)
        self._pill.copy_requested.connect(self._on_copy)

        # Dynamic menu data provider
        self._pill.set_menu_provider(self._get_menu_data)

        # Audio level polling timer (created on Qt thread, not started yet)
        self._level_timer = QTimer()

        # Pill starts hidden — shown via .show() when main window closes
        self._app.exec()

    # ------------------------------------------------------------------
    # Recording signal handlers (Qt thread)
    # ------------------------------------------------------------------

    def _on_record(self):
        result = self._api.start_recording()
        if result.get("success"):
            self._pill.set_state("recording")
            # Disconnect first to prevent accumulating duplicate connections
            try:
                self._level_timer.timeout.disconnect(self._update_level)
            except RuntimeError:
                pass
            self._level_timer.timeout.connect(self._update_level)
            self._level_timer.start(80)

    def _update_level(self):
        self._pill.set_audio_level(self._api.get_audio_level())

    def _stop_level_timer(self):
        self._level_timer.stop()
        try:
            self._level_timer.timeout.disconnect()
        except RuntimeError:
            pass

    def _on_stop(self):
        self._stop_level_timer()
        QTimer.singleShot(50, self._do_stop)

    def _do_stop(self):
        self._pill.set_state("processing")
        self._transcription_gen += 1
        gen = self._transcription_gen
        threading.Thread(target=self._transcribe, args=(gen,), daemon=True).start()

    def _transcribe(self, gen):
        result = self._api.stop_recording()
        if gen != self._transcription_gen:
            return  # cancelled — discard result
        if result.get("success"):
            text = result.get("text", "")
            if text:
                self._auto_paste(text)
            self._invoker.invoke(lambda: self._pill.set_state("success"))
        else:
            self._invoker.invoke(lambda: self._pill.set_state("error"))

    def _auto_paste(self, text):
        """Copy text to clipboard and paste into the previously focused window."""
        try:
            import ctypes
            import time
            self._api._clipboard_copy(text)
            # Restore focus to the window that was active before the pill was clicked
            hwnd = getattr(self._pill, '_prev_foreground', None)
            if hwnd and hwnd != 0:
                ctypes.windll.user32.SetForegroundWindow(hwnd)
                time.sleep(0.1)
            # Simulate Ctrl+V
            from pynput.keyboard import Controller as KbController, Key
            kb = KbController()
            kb.press(Key.ctrl)
            kb.press('v')
            kb.release('v')
            kb.release(Key.ctrl)
        except Exception:
            pass  # non-critical — text is still on clipboard

    def _on_cancel(self):
        self._stop_level_timer()
        if self._pill.get_state() == "processing":
            # Cancel in-flight transcription — bump gen so result is discarded
            self._transcription_gen += 1
            self._api._play_tone(play_cancel_tone)
            self._pill.set_state("dormant")
        else:
            QTimer.singleShot(50, self._do_cancel)

    def _do_cancel(self):
        self._api.cancel_recording()
        self._pill.set_state("dormant")

    # ------------------------------------------------------------------
    # Navigation signal handlers (Qt thread)
    # ------------------------------------------------------------------

    def _on_show_main(self):
        self._pill.hide()
        self._api.show_main_window()

    def _on_open_settings(self):
        self._pill.hide()
        self._api.show_main_window()
        self._api.open_settings_from_pill()

    def _on_hide(self):
        self._pill.hide()

    def _on_paste_last(self):
        self._api.paste_last_transcript()

    def _on_copy(self, text):
        self._api.copy_to_clipboard(text)

    # ------------------------------------------------------------------
    # Settings signal handlers (Qt thread)
    # ------------------------------------------------------------------

    def _on_sound_toggle(self, enabled):
        self._api.save_settings({"sound_enabled": enabled})

    def _on_mic_select(self, mic_id):
        self._api.set_microphone(mic_id)

    def _on_mode_toggle(self, mode):
        self._api.save_settings({"mode": mode})

    # ------------------------------------------------------------------
    # Menu data provider (Qt thread, called synchronously by aboutToShow)
    # ------------------------------------------------------------------

    def _get_menu_data(self):
        """Return (settings, mics, history, active_mic) for dynamic menu."""
        settings = self._api.get_settings()
        mics = self._api.get_microphones()
        history = self._api.get_history()[:3]
        active_mic = self._api._recorder._device_id
        return settings, mics, history, active_mic
