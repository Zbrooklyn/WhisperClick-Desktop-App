import threading
from enum import Enum
from queue import Queue, Empty

from PIL import Image, ImageDraw
import pystray

from src.audio_recorder import AudioRecorder
from src.transcription import TranscriptionService
from src.config import TranscriptionMode, HOTKEY
from src.models import is_model_downloaded, get_downloaded_models
from src.ui.main_window import MainWindow


class AppState(Enum):
    IDLE = "idle"
    RECORDING = "recording"
    PROCESSING = "processing"


class WhisperClickApp:
    def __init__(self):
        self.state = AppState.IDLE
        self.recorder = AudioRecorder()
        self.transcription = TranscriptionService()
        self.result_queue = Queue()
        self.tray_icon = None

        self.window = MainWindow()
        self.window.on_record_toggle = self.toggle_recording
        self.window.on_mode_change = self._on_mode_change
        self.window.on_model_change = self._on_model_change
        self.window.protocol("WM_DELETE_WINDOW", self._on_close)

        self._setup_hotkey()
        self._setup_tray()

    # --- Onboarding ---

    def _check_onboarding(self):
        """Show setup screen if no local model is downloaded."""
        downloaded = get_downloaded_models()
        if downloaded:
            # Already have a model, use first available
            self.transcription.set_model(downloaded[0])
            self.window.model_var.set(downloaded[0])
            return

        from src.ui.setup_screen import SetupScreen

        SetupScreen(self.window, on_complete=self._on_setup_complete)

    def _on_setup_complete(self, model_name):
        if model_name:
            self.transcription.set_model(model_name)
            self.window.model_var.set(model_name)
        else:
            # User skipped — switch to API mode
            self.window.mode_var.set("api")
            self.window._mode_changed("api")
            self._on_mode_change("api")

    # --- System tray ---

    def _create_tray_icon_image(self):
        img = Image.new("RGB", (64, 64), color=(30, 30, 30))
        draw = ImageDraw.Draw(img)
        # Simple microphone shape
        draw.ellipse([20, 8, 44, 36], fill="#2ecc71")
        draw.rectangle([26, 32, 38, 48], fill="#2ecc71")
        draw.arc([16, 36, 48, 56], start=0, end=180, fill="#2ecc71", width=3)
        draw.line([32, 56, 32, 62], fill="#2ecc71", width=3)
        return img

    def _setup_tray(self):
        icon_image = self._create_tray_icon_image()
        menu = pystray.Menu(
            pystray.MenuItem("Show", self._tray_show, default=True),
            pystray.MenuItem("Record", self._tray_toggle_record),
            pystray.Menu.SEPARATOR,
            pystray.MenuItem("Quit", self._tray_quit),
        )
        self.tray_icon = pystray.Icon("whisperclick", icon_image, "WhisperClick", menu)
        tray_thread = threading.Thread(target=self.tray_icon.run, daemon=True)
        tray_thread.start()

    def _tray_show(self, icon=None, item=None):
        self.window.after(0, self._restore_window)

    def _tray_toggle_record(self, icon=None, item=None):
        self.window.after(0, self.toggle_recording)

    def _tray_quit(self, icon=None, item=None):
        if self.tray_icon:
            self.tray_icon.stop()
        self.window.after(0, self.window.destroy)

    def _restore_window(self):
        self.window.deiconify()
        self.window.lift()
        self.window.focus_force()

    def _on_close(self):
        """Minimize to tray instead of quitting."""
        self.window.withdraw()

    # --- Hotkey ---

    def _setup_hotkey(self):
        try:
            from pynput.keyboard import GlobalHotKeys

            self._hotkey_listener = GlobalHotKeys({
                HOTKEY: self._hotkey_pressed,
            })
            self._hotkey_listener.daemon = True
            self._hotkey_listener.start()
        except Exception:
            pass

    def _hotkey_pressed(self):
        self.window.after(0, self.toggle_recording)

    # --- Recording ---

    def toggle_recording(self):
        if self.state == AppState.IDLE:
            self._start_recording()
        elif self.state == AppState.RECORDING:
            self._stop_recording()

    def _start_recording(self):
        try:
            self.recorder.start()
        except Exception as e:
            self.window.set_state_error(f"Microphone error: {e}")
            return
        self.state = AppState.RECORDING
        self.window.set_state_recording()
        if self.tray_icon:
            self.tray_icon.icon = self._create_tray_icon_recording()

    def _stop_recording(self):
        self.recorder.stop()
        if self.tray_icon:
            self.tray_icon.icon = self._create_tray_icon_image()

        duration = self.recorder.get_duration()
        if duration < 0.3:
            self.state = AppState.IDLE
            self.window.set_state_error("Recording too short. Speak for longer.")
            return

        wav_bytes = self.recorder.get_wav_bytes()
        if wav_bytes is None:
            self.state = AppState.IDLE
            self.window.set_state_error("No audio captured.")
            return

        self.state = AppState.PROCESSING
        self.window.set_state_processing()

        thread = threading.Thread(
            target=self._transcribe_worker, args=(wav_bytes,), daemon=True
        )
        thread.start()
        self.window.after(100, self._poll_result)

    def _create_tray_icon_recording(self):
        img = Image.new("RGB", (64, 64), color=(30, 30, 30))
        draw = ImageDraw.Draw(img)
        draw.ellipse([20, 8, 44, 36], fill="#e74c3c")
        draw.rectangle([26, 32, 38, 48], fill="#e74c3c")
        draw.arc([16, 36, 48, 56], start=0, end=180, fill="#e74c3c", width=3)
        draw.line([32, 56, 32, 62], fill="#e74c3c", width=3)
        return img

    def _transcribe_worker(self, wav_bytes):
        try:
            text = self.transcription.transcribe(wav_bytes)
            self.result_queue.put(("success", text))
        except Exception as e:
            self.result_queue.put(("error", str(e)))

    def _poll_result(self):
        try:
            status, data = self.result_queue.get_nowait()
            self.state = AppState.IDLE
            if status == "success":
                self.window.set_state_completed(data)
            else:
                self.window.set_state_error(data)
        except Empty:
            self.window.after(100, self._poll_result)

    def _on_mode_change(self, value):
        mode = TranscriptionMode.LOCAL if value == "local" else TranscriptionMode.API
        self.transcription.set_mode(mode)

    def _on_model_change(self, value):
        self.transcription.set_model(value)

    def run(self):
        self.window.after(100, self._check_onboarding)
        self.window.mainloop()
