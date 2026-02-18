import threading
import time
import uuid
import os
from datetime import datetime, timezone

import webview

from src.backend.audio_recorder import AudioRecorder
from src.backend.transcription import TranscriptionService
from src.backend.tones import play_start_tone, play_stop_tone, play_success_tone, play_error_tone, play_cancel_tone
from src.backend import models as model_manager
from src.backend.config import (
    LANGUAGES,
    load_settings,
    save_settings as persist_settings,
    load_history,
    save_history as persist_history,
)


class Api:
    def __init__(self):
        self._recorder = AudioRecorder()
        self._transcription = TranscriptionService()
        self._window = None

        # Load persisted settings and apply them to services
        self._settings = load_settings()
        self._transcription.set_mode(self._settings.get("mode", "local"))
        self._transcription.set_model(self._settings.get("model", "base"))
        self._transcription.set_language(self._settings.get("language", "auto"))

        # Download progress tracking (thread-safe)
        self._download_progress = None
        self._download_lock = threading.Lock()

        # Pill manager (set by main.py)
        self._pill_manager = None

    def set_window(self, window):
        self._window = window

    def minimize(self):
        """Minimize the main window."""
        if self._window:
            self._window.minimize()

    def close(self):
        """Apply close behavior (tray minimize or quit)."""
        if not self._window:
            return
        behavior = self.get_close_behavior()
        if behavior == "tray":
            self._window.hide()
            if self._pill_manager:
                self._pill_manager.show()
        else:
            self._window.destroy()

    def show_main_window(self):
        """Show and restore the main window."""
        if self._window:
            self._window.show()
            self._window.restore()

    def open_settings_from_pill(self):
        """Open settings drawer in main window (called from pill context menu)."""
        if self._window:
            self._window.evaluate_js("openSettings()")

    def set_pill_manager(self, pill_manager):
        """Set the pill manager reference (called by main.py)."""
        self._pill_manager = pill_manager

    # ------------------------------------------------------------------
    # Recording
    # ------------------------------------------------------------------

    def _play_tone(self, tone_func):
        """Play a tone only if sound is enabled."""
        if self._settings.get("sound_enabled", True):
            tone_func()

    def start_recording(self) -> dict:
        try:
            self._recorder.start()
            self._play_tone(play_start_tone)
            return {"success": True}
        except Exception as e:
            self._play_tone(play_error_tone)
            return {"success": False, "error": str(e)}

    def stop_recording(self) -> dict:
        try:
            self._recorder.stop()
            self._play_tone(play_stop_tone)
            duration = self._recorder.get_duration()
            wav_bytes = self._recorder.get_wav_bytes()

            if wav_bytes is None:
                return {"success": False, "error": "No audio recorded"}

            t0 = time.perf_counter()
            text = self._transcription.transcribe(wav_bytes)
            transcription_time = round(time.perf_counter() - t0, 2)

            # Save to history
            entry = {
                "id": str(uuid.uuid4()),
                "text": text,
                "timestamp": datetime.now(timezone.utc).isoformat(),
                "duration": round(duration, 2),
                "transcription_time": transcription_time,
            }
            history = load_history()
            history.insert(0, entry)
            persist_history(history)

            # Auto-copy if enabled
            if self._settings.get("auto_copy") and text:
                try:
                    self._clipboard_copy(text)
                except Exception:
                    pass  # Non-critical failure

            self._play_tone(play_success_tone)
            return {"success": True, "text": text, "duration": round(duration, 2), "transcription_time": transcription_time}
        except Exception as e:
            self._play_tone(play_error_tone)
            return {"success": False, "error": str(e)}

    def cancel_recording(self) -> dict:
        """Cancel the current recording without transcribing."""
        try:
            self._recorder.stop()
            self._play_tone(play_cancel_tone)
            return {"success": True}
        except Exception as e:
            return {"success": False, "error": str(e)}

    def get_audio_level(self) -> float:
        return self._recorder.get_level()

    def paste_last_transcript(self) -> dict:
        """Copy the most recent transcript to clipboard."""
        try:
            history = load_history()
            if history:
                text = history[0].get("text", "")
                if text:
                    self._clipboard_copy(text)
                    return {"success": True, "text": text}
            return {"success": False, "error": "No transcripts yet"}
        except Exception as e:
            return {"success": False, "error": str(e)}

    # ------------------------------------------------------------------
    # Microphones
    # ------------------------------------------------------------------

    def get_microphones(self) -> list:
        try:
            return AudioRecorder.list_devices()
        except Exception:
            return []

    def set_microphone(self, mic_id: int) -> dict:
        try:
            self._recorder.set_device(int(mic_id))
            return {"success": True}
        except Exception as e:
            return {"success": False, "error": str(e)}

    # ------------------------------------------------------------------
    # Models
    # ------------------------------------------------------------------

    def get_models(self) -> list:
        result = []
        for name, info in model_manager.MODEL_INFO.items():
            result.append({
                "name": name,
                "size_mb": info["size_mb"],
                "description": info["description"],
                "downloaded": model_manager.is_model_downloaded(name),
            })
        return result

    def download_model(self, name: str) -> dict:
        if name not in model_manager.MODEL_INFO:
            return {"success": False, "error": f"Unknown model: {name}"}

        with self._download_lock:
            if self._download_progress is not None:
                return {"success": False, "error": "A download is already in progress"}
            self._download_progress = {"progress": 0.0, "status": "starting"}

        def _progress_callback(downloaded, total):
            with self._download_lock:
                if total > 0:
                    self._download_progress = {
                        "progress": round(downloaded / total, 4),
                        "status": "downloading",
                    }
                else:
                    self._download_progress = {
                        "progress": 0.0,
                        "status": "downloading",
                    }

        def _download_thread():
            try:
                model_manager.download_model(name, progress_callback=_progress_callback)
                with self._download_lock:
                    self._download_progress = {
                        "progress": 1.0,
                        "status": "complete",
                    }
            except Exception as e:
                with self._download_lock:
                    self._download_progress = {
                        "progress": 0.0,
                        "status": f"error: {str(e)}",
                    }

        thread = threading.Thread(target=_download_thread, daemon=True)
        thread.start()
        return {"success": True}

    def get_download_progress(self) -> dict:
        with self._download_lock:
            if self._download_progress is None:
                return None
            progress = self._download_progress.copy()
            # Clear progress once the frontend has received a terminal state
            if progress["status"] in ("complete",) or progress["status"].startswith("error:"):
                self._download_progress = None
            return progress

    def delete_model(self, name: str) -> dict:
        try:
            model_manager.delete_model(name)
            return {"success": True}
        except Exception as e:
            return {"success": False, "error": str(e)}

    # ------------------------------------------------------------------
    # Languages
    # ------------------------------------------------------------------

    def get_languages(self) -> list:
        return LANGUAGES

    def set_language(self, code: str) -> dict:
        try:
            self._transcription.set_language(code)
            self._settings["language"] = code
            persist_settings(self._settings)
            return {"success": True}
        except Exception as e:
            return {"success": False, "error": str(e)}

    # ------------------------------------------------------------------
    # Mode / Model selection
    # ------------------------------------------------------------------

    def set_mode(self, mode: str) -> dict:
        if mode not in ("local", "api"):
            return {"success": False, "error": f"Invalid mode: {mode}"}
        try:
            self._transcription.set_mode(mode)
            self._settings["mode"] = mode
            persist_settings(self._settings)
            return {"success": True}
        except Exception as e:
            return {"success": False, "error": str(e)}

    def set_model(self, name: str) -> dict:
        if name not in model_manager.MODEL_INFO:
            return {"success": False, "error": f"Unknown model: {name}"}
        try:
            self._transcription.set_model(name)
            self._settings["model"] = name
            persist_settings(self._settings)
            return {"success": True}
        except Exception as e:
            return {"success": False, "error": str(e)}

    # ------------------------------------------------------------------
    # Settings
    # ------------------------------------------------------------------

    def get_settings(self) -> dict:
        self._settings = load_settings()
        return self._settings

    def save_settings(self, settings: dict) -> dict:
        try:
            self._settings = {**self._settings, **settings}
            persist_settings(self._settings)

            # Apply relevant settings to services
            if "mode" in settings:
                self._transcription.set_mode(settings["mode"])
            if "model" in settings:
                self._transcription.set_model(settings["model"])
            if "language" in settings:
                self._transcription.set_language(settings["language"])

            # Apply start_with_windows to registry
            if "start_with_windows" in settings:
                self._set_autostart(settings["start_with_windows"])

            # Apply always_on_top
            if "always_on_top" in settings and self._window:
                self._window.on_top = settings["always_on_top"]

            # Apply pill widget toggle dynamically
            if "show_pill_widget" in settings and self._pill_manager:
                if settings["show_pill_widget"]:
                    self._pill_manager.start()
                else:
                    self._pill_manager.stop()

            return {"success": True}
        except Exception as e:
            return {"success": False, "error": str(e)}

    def get_close_behavior(self) -> str:
        return self._settings.get("close_behavior", "tray")

    @staticmethod
    def _set_autostart(enabled: bool):
        """Add or remove WhisperClick from Windows startup via registry."""
        try:
            import winreg
            key = winreg.OpenKey(
                winreg.HKEY_CURRENT_USER,
                r"Software\Microsoft\Windows\CurrentVersion\Run",
                0, winreg.KEY_SET_VALUE,
            )
            if enabled:
                import sys
                if getattr(sys, "frozen", False):
                    launch_cmd = f'"{sys.executable}"'
                else:
                    pythonw = os.path.join(os.path.dirname(sys.executable), "pythonw.exe")
                    python_exe = pythonw if os.path.exists(pythonw) else sys.executable
                    main_py = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "main.py"))
                    launch_cmd = f'"{python_exe}" "{main_py}"'
                winreg.SetValueEx(key, "WhisperClick", 0, winreg.REG_SZ, launch_cmd)
            else:
                try:
                    winreg.DeleteValue(key, "WhisperClick")
                except FileNotFoundError:
                    pass
            winreg.CloseKey(key)
        except Exception:
            pass  # Non-critical — may fail on non-Windows or without permissions

    # ------------------------------------------------------------------
    # Export / Clipboard
    # ------------------------------------------------------------------

    def export_transcription(self, text: str, format: str) -> dict:
        try:
            file_types = {
                "txt": ("Text Files (*.txt)",),
                "srt": ("SRT Subtitle Files (*.srt)",),
                "json": ("JSON Files (*.json)",),
            }
            ft = file_types.get(format, ("Text Files (*.txt)",))

            result = webview.windows[0].create_file_dialog(
                webview.SAVE_DIALOG,
                file_types=ft,
            )

            if result:
                file_path = result if isinstance(result, str) else result[0]
                # Ensure correct extension
                if not file_path.endswith(f".{format}"):
                    file_path += f".{format}"

                with open(file_path, "w", encoding="utf-8") as f:
                    f.write(text)
                return {"success": True, "path": file_path}
            return {"success": False, "error": "Export cancelled"}
        except Exception as e:
            return {"success": False, "error": str(e)}

    def copy_to_clipboard(self, text: str) -> dict:
        try:
            self._clipboard_copy(text)
            return {"success": True}
        except Exception as e:
            return {"success": False, "error": str(e)}

    @staticmethod
    def _clipboard_copy(text: str):
        """Copy text to the system clipboard using tkinter."""
        import tkinter as tk
        root = tk.Tk()
        root.withdraw()
        root.clipboard_clear()
        root.clipboard_append(text)
        root.update()  # Required for clipboard to persist
        root.destroy()

    # ------------------------------------------------------------------
    # History
    # ------------------------------------------------------------------

    def get_history(self) -> list:
        return load_history()

    def delete_history(self, history_id: str) -> dict:
        try:
            history = load_history()
            history = [entry for entry in history if entry.get("id") != history_id]
            persist_history(history)
            return {"success": True}
        except Exception as e:
            return {"success": False, "error": str(e)}

    def clear_history(self) -> dict:
        try:
            persist_history([])
            return {"success": True}
        except Exception as e:
            return {"success": False, "error": str(e)}

    # ------------------------------------------------------------------
    # Onboarding
    # ------------------------------------------------------------------

    def check_onboarding(self) -> dict:
        downloaded = model_manager.get_downloaded_models()
        return {
            "needs_setup": len(downloaded) == 0,
            "downloaded_models": downloaded,
        }
