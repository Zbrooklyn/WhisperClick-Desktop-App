"""Launcher for pill widget standalone test."""

import ctypes
import os
import sys

# Hide the console window
try:
    ctypes.windll.user32.ShowWindow(ctypes.windll.kernel32.GetConsoleWindow(), 0)
except Exception:
    pass

ROOT = os.path.dirname(os.path.abspath(__file__))
os.chdir(ROOT)
sys.path.insert(0, ROOT)

try:
    import random

    from PySide6.QtCore import QTimer
    from PySide6.QtWidgets import QApplication

    from src.backend.tones import play_cancel_tone, play_start_tone, play_stop_tone, play_success_tone
    from src.pill_widget import PillWidget

    app = QApplication(sys.argv)
    pill = PillWidget()

    level_timer = QTimer()

    def stop_level_timer():
        level_timer.stop()
        try:
            level_timer.timeout.disconnect()
        except RuntimeError:
            pass

    def on_record():
        play_start_tone()
        pill.set_state("recording")

        def update_level():
            pill.set_audio_level(random.random() * 0.8 + 0.1)

        level_timer.timeout.connect(update_level)
        level_timer.start(80)

    def on_stop():
        stop_level_timer()
        # Small delay so audio device is free
        QTimer.singleShot(50, _do_stop)

    def _do_stop():
        play_stop_tone()
        pill.set_state("processing")

        def on_done():
            play_success_tone()
            pill.set_state("success")

        QTimer.singleShot(2000, on_done)

    def on_cancel():
        stop_level_timer()
        QTimer.singleShot(50, _do_cancel)

    def _do_cancel():
        play_cancel_tone()
        pill.set_state("dormant")

    def on_hide():
        pill.hide()
        QTimer.singleShot(2000, pill.show)

    pill.record_requested.connect(on_record)
    pill.stop_requested.connect(on_stop)
    pill.cancel_requested.connect(on_cancel)
    pill.show_main_requested.connect(lambda: None)
    pill.open_settings_requested.connect(lambda: None)
    pill.paste_last_requested.connect(lambda: None)
    pill.hide_requested.connect(on_hide)

    pill.show()
    sys.exit(app.exec())

except Exception:
    import traceback

    with open(os.path.join(ROOT, "pill_error.log"), "w") as f:
        traceback.print_exc(file=f)
