import ctypes
import threading
import time
import uuid
import os
from datetime import datetime, timezone
from typing import Optional
from urllib import error as urllib_error
from urllib import parse as urllib_parse
from urllib import request as urllib_request

import webview

try:
    import keyring
except Exception:  # pragma: no cover - optional dependency fallback
    keyring = None

try:
    from keyring.errors import PasswordDeleteError
except Exception:  # pragma: no cover - keyring may be unavailable
    class PasswordDeleteError(Exception):
        pass

from src.backend.audio_recorder import AudioRecorder
from src.backend.transcription import TranscriptionService, TranscriptionCancelled
from src.backend.tones import play_start_tone, play_stop_tone, play_success_tone, play_error_tone, play_cancel_tone
from src.backend import models as model_manager
import soundfile as sf

from src.backend.config import (
    AUDIO_DIR,
    LANGUAGES,
    load_settings,
    save_settings as persist_settings,
    load_history,
    save_history as persist_history,
)


class Api:
    _API_KEY_SERVICE = "WhisperClick"
    _API_KEY_ACCOUNT = {
        "openai": "openai_api_key",
        "gemini": "gemini_api_key",
    }

    def __init__(self):
        self._recorder = AudioRecorder()
        self._transcription = TranscriptionService()
        self._window = None
        self._hotkey_updater = None

        # Load persisted settings and apply them to services
        self._settings = load_settings()
        self._transcription.set_mode(self._settings.get("mode", "local"))
        self._transcription.set_model(self._settings.get("model", "base"))
        self._transcription.set_language(self._settings.get("language", "auto"))

        # Download progress tracking (thread-safe)
        self._download_progress = None
        self._download_lock = threading.Lock()

        # Clean up expired audio files from previous sessions
        self._cleanup_expired_audio()

        # Pill manager (set by main.py)
        self._pill_manager = None
        self._pending_pill_state = None  # queued state if pill unavailable

        # Auto-paste: foreground window handle captured before hotkey fires
        self._paste_target_hwnd = None

    @classmethod
    def _normalize_provider(cls, provider: str) -> Optional[str]:
        normalized = str(provider or "").strip().lower()
        if normalized in cls._API_KEY_ACCOUNT:
            return normalized
        return None

    @classmethod
    def _settings_api_key_field(cls, provider: str) -> str:
        return f"{provider}_api_key"

    @classmethod
    def _keyring_available(cls) -> bool:
        return keyring is not None

    def _store_api_key_settings_fallback(self, provider: str, value: str):
        field = self._settings_api_key_field(provider)
        if value:
            self._settings[field] = value
        else:
            self._settings.pop(field, None)
        persist_settings(self._settings)

    def _read_api_key_settings_fallback(self, provider: str) -> str:
        field = self._settings_api_key_field(provider)
        return str(self._settings.get(field, "") or "")

    def _clear_api_key_settings_fallback(self, provider: str):
        field = self._settings_api_key_field(provider)
        if field in self._settings:
            self._settings.pop(field, None)
            persist_settings(self._settings)

    def _set_api_key_keyring(self, provider: str, value: str):
        account = self._API_KEY_ACCOUNT[provider]
        if value:
            keyring.set_password(self._API_KEY_SERVICE, account, value)
        else:
            try:
                keyring.delete_password(self._API_KEY_SERVICE, account)
            except PasswordDeleteError:
                pass

    def _get_api_key_keyring(self, provider: str) -> str:
        account = self._API_KEY_ACCOUNT[provider]
        return str(keyring.get_password(self._API_KEY_SERVICE, account) or "")

    def set_window(self, window):
        self._window = window

    def minimize(self):
        """Minimize the main window."""
        if self._window:
            self._window.minimize()

    # ------------------------------------------------------------------
    # Window drag (physical-pixel approach — no DPI conversion needed)
    # ------------------------------------------------------------------
    _drag_state = {}

    def drag_start(self):
        """Called on mousedown in drag region. Stores physical positions."""
        import ctypes
        import ctypes.wintypes as wintypes
        cursor = wintypes.POINT()
        ctypes.windll.user32.GetCursorPos(ctypes.byref(cursor))
        hwnd = ctypes.windll.user32.FindWindowW(None, "WhisperClick")
        if not hwnd:
            return
        rect = wintypes.RECT()
        ctypes.windll.user32.GetWindowRect(hwnd, ctypes.byref(rect))
        self._drag_state = {
            'cursor_x': cursor.x, 'cursor_y': cursor.y,
            'win_x': rect.left, 'win_y': rect.top,
            'hwnd': hwnd, 'active': True,
        }

    def drag_move(self):
        """Called on mousemove during drag. Uses physical pixel deltas only."""
        if not self._drag_state.get('active'):
            return
        import ctypes
        import ctypes.wintypes as wintypes
        cursor = wintypes.POINT()
        ctypes.windll.user32.GetCursorPos(ctypes.byref(cursor))
        dx = cursor.x - self._drag_state['cursor_x']
        dy = cursor.y - self._drag_state['cursor_y']
        new_x = self._drag_state['win_x'] + dx
        new_y = self._drag_state['win_y'] + dy
        SWP_NOSIZE = 0x0001
        SWP_NOZORDER = 0x0004
        SWP_NOACTIVATE = 0x0010
        ctypes.windll.user32.SetWindowPos(
            self._drag_state['hwnd'], 0,
            new_x, new_y, 0, 0,
            SWP_NOSIZE | SWP_NOZORDER | SWP_NOACTIVATE
        )

    def drag_end(self):
        """Called on mouseup to end drag."""
        self._drag_state['active'] = False

    def resize_window(self, width, height):
        """Resize the main window."""
        if self._window:
            self._window.resize(int(width), int(height))

    def close(self):
        """Apply close behavior (tray minimize or quit)."""
        if not self._window:
            return
        behavior = self.get_close_behavior()
        if behavior == "tray":
            self._window.hide()
            if self._pill_manager and self._settings.get("show_pill_widget", False):
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
            self._window.evaluate_js("openSettingsDrawer()")

    def show_pill_widget(self) -> dict:
        """Show floating pill widget (called from pill/main UI actions)."""
        try:
            if self._pill_manager:
                self._pill_manager.show()
            return {"success": True}
        except Exception as e:
            return {"success": False, "error": str(e)}

    def hide_pill_widget(self) -> dict:
        """Hide floating pill widget (called from pill context menu)."""
        try:
            if self._pill_manager:
                self._pill_manager.hide()
            return {"success": True}
        except Exception as e:
            return {"success": False, "error": str(e)}

    def set_pill_manager(self, pill_manager):
        """Set the pill manager reference (called by main.py)."""
        self._pill_manager = pill_manager
        # Replay any queued notification that was missed while pill was unavailable
        pending = self._pending_pill_state
        if pending and pill_manager:
            self._pending_pill_state = None
            self._notify_pill(pending)

    def _notify_frontend(self, state: str):
        """Push a state change to the webview frontend (best-effort).

        Keeps the main window UI in sync when actions originate from the
        pill widget, tray, or hotkey rather than the frontend itself.
        """
        w = self._window
        if not w:
            return
        try:
            if state == "dormant":
                w.evaluate_js("if(typeof endProcessingState==='function'){endProcessingState();} if(typeof clearInterval!=='undefined'){clearInterval(timerInterval);} isRecording=false; if(typeof setIdleUi==='function'){setIdleUi();}")
            elif state == "recording":
                w.evaluate_js("if(typeof setRecordingUi==='function'){isRecording=true;isProcessing=false;}")
        except Exception:
            pass

    def _notify_pill(self, state: str):
        """Push a state change to the pill widget (thread-safe, best-effort).

        Called from start/stop/cancel so the pill stays in sync regardless
        of whether the action originated from the main UI, hotkey, or tray.
        """
        pm = self._pill_manager
        if not pm or not getattr(pm, '_invoker', None) or not getattr(pm, '_pill', None):
            self._pending_pill_state = state  # queue for replay on reconnect
            return
        try:
            if state == "recording":
                pm._invoker.invoke(lambda: pm._pill.set_state("recording"))
                pm._invoker.invoke(lambda: pm._start_level_polling())
            elif state == "processing":
                pm._invoker.invoke(lambda: pm._stop_level_polling())
                pm._invoker.invoke(lambda: pm._pill.set_state("processing"))
            elif state == "success":
                pm._invoker.invoke(lambda: pm._stop_level_polling())
                pm._invoker.invoke(lambda: pm._pill.set_state("success"))
            elif state == "error":
                pm._invoker.invoke(lambda: pm._stop_level_polling())
                pm._invoker.invoke(lambda: pm._pill.set_state("error"))
            elif state == "dormant":
                pm._invoker.invoke(lambda: pm._stop_level_polling())
                pm._invoker.invoke(lambda: pm._pill.set_state("dormant"))
        except Exception:
            pass

    def set_hotkey_updater(self, updater):
        """Set callback that applies updated global hotkey bindings at runtime."""
        self._hotkey_updater = updater

    # ------------------------------------------------------------------
    # Recording
    # ------------------------------------------------------------------

    _TONE_MAP = {
        "start": play_start_tone,
        "stop": play_stop_tone,
        "success": play_success_tone,
        "error": play_error_tone,
        "cancel": play_cancel_tone,
    }

    def _play_tone(self, tone_func):
        """Play a tone only if sound is enabled."""
        if self._settings.get("sound_enabled", True):
            tone_func()

    def play_tone(self, name: str) -> dict:
        """Play a named tone (start/stop/success/error/cancel).

        Exposed to the frontend so API-mode recording can trigger tones
        without going through the full start_recording/stop_recording path.
        """
        tone_func = self._TONE_MAP.get(name)
        if tone_func:
            self._play_tone(tone_func)
            return {"success": True}
        return {"success": False, "error": f"Unknown tone: {name}"}

    def start_recording(self) -> dict:
        try:
            self._transcription.clear_cancel_request()
            self._recorder.start()
            self._play_tone(play_start_tone)
            self._notify_pill("recording")
            return {"success": True}
        except Exception as e:
            self._play_tone(play_error_tone)
            return {"success": False, "error": str(e)}

    # Default base URLs per provider — used when api_base_url in settings
    # belongs to a different provider (stale from a provider switch).
    _PROVIDER_BASE_URLS = {
        "openai": "https://api.openai.com/v1",
        "gemini": "https://generativelanguage.googleapis.com/v1beta",
    }

    @staticmethod
    def _guess_language(text, target_lang):
        """Best-effort language guess from text script when no model detection available.

        Returns a language code if confident, or "auto" if uncertain.
        Last-resort fallback for Gemini (OpenAI uses verbose_json detection).
        """
        if not text or len(text.strip()) < 5:
            return "auto"

        chars = text.strip()
        # Count character types (letters only — ignore spaces/punctuation/numbers)
        ascii_letters = sum(1 for c in chars if 'a' <= c.lower() <= 'z')
        cjk = sum(1 for c in chars if '\u4e00' <= c <= '\u9fff')
        hangul = sum(1 for c in chars if '\uac00' <= c <= '\ud7af')
        kana = sum(1 for c in chars if '\u3040' <= c <= '\u30ff')
        arabic = sum(1 for c in chars if '\u0600' <= c <= '\u06ff')
        devanagari = sum(1 for c in chars if '\u0900' <= c <= '\u097f')
        total_letters = ascii_letters + cjk + hangul + kana + arabic + devanagari
        if total_letters == 0:
            return "auto"

        # CJK-dominant → Chinese (or Japanese if mixed with kana)
        if (cjk + kana) / total_letters > 0.3:
            return "ja" if kana > 0 else "zh"
        if hangul / total_letters > 0.3:
            return "ko"
        if arabic / total_letters > 0.3:
            return "ar"
        if devanagari / total_letters > 0.3:
            return "hi"

        # Latin-script dominant: only confident about English if target is "en"
        # (can't reliably distinguish en/es/fr/de/pt from script alone)
        if ascii_letters / total_letters > 0.85 and target_lang == "en":
            return "en"

        return "auto"

    def _inject_api_credentials(self):
        """Inject provider+key+model so all paths (pill, tray, main) share one pipeline."""
        provider = self._settings.get("api_provider", "openai")
        api_model = self._settings.get("api_model", "")
        key_result = self.get_api_key(provider)
        api_key = key_result.get("api_key", "")
        # Resolve base_url: use stored value only if it matches the active provider,
        # otherwise fall back to the provider's default URL.
        stored_url = self._settings.get("api_base_url", "")
        provider_default = self._PROVIDER_BASE_URLS.get(provider, "")
        other_defaults = [v for k, v in self._PROVIDER_BASE_URLS.items() if k != provider]
        if stored_url and stored_url not in other_defaults:
            base_url = stored_url
        else:
            base_url = provider_default
        self._transcription.set_api_credentials(provider, api_key, base_url)
        if api_model:
            self._transcription.set_api_model(api_model)

    def stop_recording(self) -> dict:
        try:
            self._recorder.stop()
            self._play_tone(play_stop_tone)
            self._notify_pill("processing")
            duration = self._recorder.get_duration()

            t0 = time.perf_counter()
            self._transcription.clear_cancel_request()

            # Inject API credentials for both transcription and translation.
            self._inject_api_credentials()

            # Local mode: pass raw numpy array (~34% faster, skips WAV encode/decode)
            # API mode: pass WAV BytesIO (needed for upload)
            if self._transcription.mode == "local":
                audio = self._recorder.get_audio_numpy()
            else:
                audio = self._recorder.get_wav_bytes()

            if audio is None:
                return {"success": False, "error": "No audio recorded"}

            text = self._transcription.transcribe(audio)
            transcript = text
            translation = ""

            # Translation (if output_mode requires it)
            output_mode = self._settings.get("output_mode", "both")
            target_language = self._settings.get("target_language", "en")
            source_language = self._settings.get("source_language", "auto")

            # Determine effective source language: explicit setting or detected
            effective_source = source_language
            if effective_source == "auto" and self._transcription.detected_language:
                effective_source = self._transcription.detected_language
            # Fallback: if still "auto", infer from text script/charset
            if effective_source == "auto" and text.strip():
                effective_source = self._guess_language(text, target_language)

            # Skip translation if source matches target (e.g. English→English)
            skip_translate = (
                effective_source != "auto"
                and effective_source.lower() == target_language.lower()
            )

            if output_mode in ("translate", "both") and text.strip() and not skip_translate:
                try:
                    translation = self._transcription.translate(
                        text, target_language, source_language
                    )
                except Exception as translate_err:
                    translation = f"[Translation failed: {translate_err}]"

            # Format output text based on output_mode
            if output_mode == "translate" and translation:
                if translation.startswith("[Translation failed:"):
                    output_text = f"{text}\n\n{translation}"
                else:
                    output_text = translation
            elif output_mode == "both" and translation:
                if translation.startswith("[Translation failed:"):
                    output_text = f"{text}\n\n{translation}"
                elif translation.strip().lower() == text.strip().lower():
                    output_text = text  # Same text — no point showing both
                else:
                    output_text = (
                        f"Transcript:\n{text}\n\n"
                        f"Translation ({target_language}):\n{translation}"
                    )
            else:
                output_text = text

            transcription_time = round(time.perf_counter() - t0, 2)

            # Save to history
            entry = {
                "id": str(uuid.uuid4()),
                "text": output_text,
                "timestamp": datetime.now(timezone.utc).isoformat(),
                "duration": round(duration, 2),
                "transcription_time": transcription_time,
            }

            # Save compressed audio recording (buffer still valid until next start())
            audio_path = self._save_audio(entry["id"])
            if audio_path:
                entry["audio_file"] = os.path.basename(audio_path)

            history = load_history()
            history.insert(0, entry)
            persist_history(history)

            # Auto-copy + auto-paste if enabled
            if self._settings.get("auto_copy") and output_text:
                try:
                    copy_target = self._settings.get("auto_copy_target", "both")
                    if copy_target == "transcript":
                        paste_text = text
                    elif copy_target == "translation" and translation:
                        paste_text = translation
                    else:
                        paste_text = output_text
                    self._auto_paste(paste_text)
                except Exception:
                    pass  # Non-critical failure

            self._play_tone(play_success_tone)
            self._notify_pill("success")
            return {
                "success": True,
                "text": output_text,
                "transcript": transcript,
                "translation": translation,
                "duration": round(duration, 2),
                "transcription_time": transcription_time,
            }
        except TranscriptionCancelled:
            self._notify_pill("dormant")
            return {"success": False, "cancelled": True, "error": "Transcription cancelled"}
        except Exception as e:
            self._play_tone(play_error_tone)
            self._notify_pill("error")
            return {"success": False, "error": str(e)}

    def cancel_recording(self) -> dict:
        """Cancel the current recording without transcribing."""
        try:
            self._transcription.request_cancel()
            self._recorder.stop()
            self._play_tone(play_cancel_tone)
            self._notify_pill("dormant")
            self._notify_frontend("dormant")
            return {"success": True}
        except Exception as e:
            return {"success": False, "error": str(e)}

    def cancel_processing(self) -> dict:
        """Request cancellation of an in-flight transcription job."""
        self._transcription.request_cancel()
        self._play_tone(play_cancel_tone)
        self._notify_pill("dormant")
        self._notify_frontend("dormant")
        return {"success": True}

    def get_audio_level(self) -> float:
        return self._recorder.get_level()

    def get_recording_state(self) -> dict:
        """Return authoritative backend recording/processing state."""
        return {
            "is_recording": self._recorder.is_recording(),
            "cancel_requested": self._transcription.is_cancel_requested(),
        }

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
    # Monitors
    # ------------------------------------------------------------------

    def get_monitors(self) -> list:
        """Return list of connected monitors for the pill display dropdown."""
        import ctypes
        import ctypes.wintypes as wintypes

        monitors = []

        def _enum_cb(hMonitor, hdcMonitor, lprcMonitor, dwData):
            r = lprcMonitor.contents

            # MONITORINFOEXW for device name + primary flag
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

            is_primary = bool(info.dwFlags & 1)  # MONITORINFOF_PRIMARY
            width = r.right - r.left
            height = r.bottom - r.top
            idx = len(monitors)

            label = f"Display {idx + 1} \u2014 {width}\u00d7{height}"
            if is_primary:
                label += " (Primary)"

            monitors.append({
                "index": idx,
                "name": f"Display {idx + 1}",
                "resolution": f"{width}x{height}",
                "primary": is_primary,
                "label": label,
            })
            return True

        MONITORENUMPROC = ctypes.WINFUNCTYPE(
            ctypes.c_int, wintypes.HMONITOR, wintypes.HDC,
            ctypes.POINTER(wintypes.RECT), wintypes.LPARAM,
        )
        ctypes.windll.user32.EnumDisplayMonitors(
            None, None, MONITORENUMPROC(_enum_cb), 0
        )

        return monitors

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
        # Never expose API keys to frontend — they have their own secure endpoint
        safe = {k: v for k, v in self._settings.items()
                if not k.endswith("_api_key")}
        return safe

    def save_settings(self, settings: dict) -> dict:
        try:
            self._settings = {**self._settings, **settings}
            persist_settings(self._settings)
            result = {"success": True}

            # Apply relevant settings to services
            if "mode" in settings:
                self._transcription.set_mode(settings["mode"])
            if "model" in settings:
                self._transcription.set_model(settings["model"])
            if "language" in settings:
                self._transcription.set_language(settings["language"])
            if "api_provider" in settings or "api_model" in settings or "api_base_url" in settings:
                provider = self._settings.get("api_provider", "openai")
                api_model = self._settings.get("api_model", "")
                base_url = self._settings.get("api_base_url", "")
                if api_model:
                    self._transcription.set_api_model(api_model)
                self._transcription.set_api_credentials(provider, "", base_url)
            if "hotkey" in settings and self._hotkey_updater:
                try:
                    rebind = self._hotkey_updater(settings["hotkey"])
                    if isinstance(rebind, dict):
                        if not rebind.get("success"):
                            result["warning"] = rebind.get("error", "Hotkey saved but could not be applied globally.")
                        if rebind.get("binding"):
                            result["hotkey_binding"] = rebind["binding"]
                except Exception as e:
                    result["warning"] = f"Hotkey saved but runtime rebind failed: {e}"

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

            # Apply pill monitor selection
            if "pill_monitor" in settings and self._pill_manager:
                self._pill_manager.set_monitor(settings["pill_monitor"])

            return result
        except Exception as e:
            return {"success": False, "error": str(e)}

    # ------------------------------------------------------------------
    # API Key persistence (secure storage with settings fallback)
    # ------------------------------------------------------------------

    def set_api_key(self, provider: str, api_key: str) -> dict:
        normalized_provider = self._normalize_provider(provider)
        if not normalized_provider:
            return {"success": False, "error": f"Invalid provider: {provider}"}

        value = str(api_key or "").strip()

        if self._keyring_available():
            try:
                self._set_api_key_keyring(normalized_provider, value)
                self._clear_api_key_settings_fallback(normalized_provider)
                return {"success": True, "storage": "keyring"}
            except Exception:
                # Fall back so persistence still works.
                self._store_api_key_settings_fallback(normalized_provider, value)
                return {
                    "success": True,
                    "storage": "settings",
                    "warning": "Secure storage unavailable; using settings fallback.",
                }

        self._store_api_key_settings_fallback(normalized_provider, value)
        return {
            "success": True,
            "storage": "settings",
            "warning": "Secure storage library unavailable; using settings fallback.",
        }

    def get_api_key(self, provider: str) -> dict:
        normalized_provider = self._normalize_provider(provider)
        if not normalized_provider:
            return {"success": False, "error": f"Invalid provider: {provider}", "api_key": ""}

        if self._keyring_available():
            try:
                key = self._get_api_key_keyring(normalized_provider)
                if key:
                    # Ensure old fallback data does not linger once keyring is active.
                    self._clear_api_key_settings_fallback(normalized_provider)
                    return {"success": True, "api_key": key, "storage": "keyring"}

                # Migration path from prior fallback value.
                fallback_key = self._read_api_key_settings_fallback(normalized_provider)
                if fallback_key:
                    try:
                        self._set_api_key_keyring(normalized_provider, fallback_key)
                        self._clear_api_key_settings_fallback(normalized_provider)
                        return {"success": True, "api_key": fallback_key, "storage": "keyring"}
                    except Exception:
                        return {"success": True, "api_key": fallback_key, "storage": "settings"}
                return {"success": True, "api_key": "", "storage": "keyring"}
            except Exception:
                pass

        fallback_key = self._read_api_key_settings_fallback(normalized_provider)
        return {"success": True, "api_key": fallback_key, "storage": "settings"}

    def get_api_keys(self) -> dict:
        openai = self.get_api_key("openai")
        gemini = self.get_api_key("gemini")
        return {
            "success": bool(openai.get("success")) and bool(gemini.get("success")),
            "openai": openai.get("api_key", ""),
            "gemini": gemini.get("api_key", ""),
            "storage": {
                "openai": openai.get("storage", ""),
                "gemini": gemini.get("storage", ""),
            },
        }

    def verify_api_key(self, provider: str, api_key: str, base_url: str = "") -> dict:
        normalized_provider = self._normalize_provider(provider)
        if not normalized_provider:
            return {"success": False, "valid": False, "error": f"Invalid provider: {provider}"}

        key = str(api_key or "").strip()
        if not key:
            return {"success": False, "valid": False, "error": "API key is required."}

        base = str(base_url or "").strip().rstrip("/")
        if not base:
            if normalized_provider == "openai":
                base = "https://api.openai.com/v1"
            else:
                base = "https://generativelanguage.googleapis.com/v1beta"

        try:
            if normalized_provider == "openai":
                # Fast auth check against models endpoint.
                url = f"{base}/models"
                req = urllib_request.Request(
                    url,
                    headers={"Authorization": f"Bearer {key}"},
                    method="GET",
                )
            else:
                # Fast auth check against Gemini models endpoint.
                encoded_key = urllib_parse.quote(key, safe="")
                url = f"{base}/models?key={encoded_key}"
                req = urllib_request.Request(url, method="GET")

            with urllib_request.urlopen(req, timeout=10) as response:
                status = int(getattr(response, "status", 200))
                return {"success": True, "valid": True, "status": status}
        except urllib_error.HTTPError as exc:
            status = int(getattr(exc, "code", 0) or 0)
            try:
                detail = exc.read(1024).decode("utf-8", errors="ignore").strip()
            except Exception:
                detail = ""
            lowered_detail = detail.lower()

            if status in (401, 403):
                return {"success": True, "valid": False, "status": status, "error": "Invalid API key."}
            if status == 400 and "api key" in lowered_detail and ("not valid" in lowered_detail or "invalid" in lowered_detail):
                return {"success": True, "valid": False, "status": status, "error": "Invalid API key."}

            error_msg = f"Verification failed ({status})."
            if detail:
                # Sanitize — never leak API key in error detail
                safe_detail = detail[:160].replace(key, "***") if key else detail[:160]
                error_msg = f"{error_msg} {safe_detail}"
            return {"success": False, "valid": False, "status": status, "error": error_msg}
        except urllib_error.URLError:
            return {
                "success": False,
                "valid": False,
                "error": "Network error while verifying key. Check connection or base URL.",
            }
        except Exception as exc:
            return {"success": False, "valid": False, "error": str(exc)}

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
        root = None
        try:
            root = tk.Tk()
            root.withdraw()
            root.clipboard_clear()
            root.clipboard_append(text)
            root.update()  # Required for clipboard to persist
        finally:
            if root:
                try:
                    root.destroy()
                except Exception:
                    pass

    def capture_paste_target(self):
        """Snapshot the current foreground window as the paste target.

        Called by the hotkey handler *before* triggering the recording toggle,
        so the handle belongs to the app the user was typing in.
        """
        try:
            hwnd = ctypes.windll.user32.GetForegroundWindow()
            if hwnd:
                self._paste_target_hwnd = hwnd
        except Exception:
            pass

    def _auto_paste(self, text: str):
        """Copy text to clipboard and paste into the user's active window.

        Strategy:
        1. Copy text to clipboard.
        2. Check current foreground window — if it's NOT WhisperClick,
           the user already clicked back to their target (click-record case).
        3. Otherwise, use the saved hotkey-capture handle.
        4. Restore focus and simulate Ctrl+V.
        """
        self._clipboard_copy(text)
        try:
            import time
            from pynput.keyboard import Controller as KbController, Key

            # Find WhisperClick's own window handle
            wc_hwnd = ctypes.windll.user32.FindWindowW(None, "WhisperClick")
            current_fg = ctypes.windll.user32.GetForegroundWindow()

            # Pick the paste target
            target = None
            if current_fg and current_fg != wc_hwnd:
                # User already switched to their target app (click-record case)
                target = current_fg
            elif self._paste_target_hwnd and self._paste_target_hwnd != wc_hwnd:
                # Use the hotkey-captured handle
                target = self._paste_target_hwnd

            if not target:
                return  # No valid target — text is still on clipboard

            ctypes.windll.user32.SetForegroundWindow(target)
            time.sleep(0.08)
            kb = KbController()
            kb.press(Key.ctrl)
            kb.press('v')
            kb.release('v')
            kb.release(Key.ctrl)
        except Exception:
            pass  # Non-critical — text is still on clipboard

    # ------------------------------------------------------------------
    # History
    # ------------------------------------------------------------------

    def append_history_item(self, text: str, duration: float = 0.0, transcription_time: float = 0.0) -> dict:
        """Append a transcript card to persisted history (used by API-mode frontend flows)."""
        try:
            entry = {
                "id": str(uuid.uuid4()),
                "text": str(text or ""),
                "timestamp": datetime.now(timezone.utc).isoformat(),
                "duration": round(max(float(duration), 0.0), 2),
                "transcription_time": round(max(float(transcription_time), 0.0), 2),
            }
            history = load_history()
            history.insert(0, entry)
            persist_history(history)

            # Keep behavior consistent with local mode.
            if self._settings.get("auto_copy") and entry["text"].strip():
                try:
                    self._clipboard_copy(entry["text"])
                except Exception:
                    pass  # Non-critical failure

            return {"success": True, "entry": entry}
        except Exception as e:
            return {"success": False, "error": str(e)}

    def get_history(self) -> list:
        return load_history()

    def delete_history(self, history_id: str) -> dict:
        try:
            history = load_history()
            # Delete associated audio file if present
            for entry in history:
                if entry.get("id") == history_id and entry.get("audio_file"):
                    try:
                        os.remove(os.path.join(AUDIO_DIR, entry["audio_file"]))
                    except FileNotFoundError:
                        pass
                    break
            history = [entry for entry in history if entry.get("id") != history_id]
            persist_history(history)
            return {"success": True}
        except Exception as e:
            return {"success": False, "error": str(e)}

    def clear_history(self) -> dict:
        try:
            # Delete all audio files
            if os.path.isdir(AUDIO_DIR):
                for fname in os.listdir(AUDIO_DIR):
                    try:
                        os.remove(os.path.join(AUDIO_DIR, fname))
                    except Exception:
                        pass
            persist_history([])
            return {"success": True}
        except Exception as e:
            return {"success": False, "error": str(e)}

    # ------------------------------------------------------------------
    # Audio storage
    # ------------------------------------------------------------------

    def _save_audio(self, audio_id):
        """Compress and save current recording to disk as OGG/Opus."""
        try:
            wav_bytes = self._recorder.get_wav_bytes()
            if wav_bytes is None:
                return None
            os.makedirs(AUDIO_DIR, exist_ok=True)
            data, sr = sf.read(wav_bytes, dtype="float32")
            out_path = os.path.join(AUDIO_DIR, f"{audio_id}.ogg")
            sf.write(out_path, data, sr, format="OGG", subtype="OPUS")
            return out_path
        except Exception:
            return None

    def get_audio(self, history_id: str) -> dict:
        """Return base64-encoded OGG audio for playback in frontend."""
        import base64
        history = load_history()
        entry = next((e for e in history if e.get("id") == history_id), None)
        if not entry or not entry.get("audio_file"):
            return {"success": False, "error": "No audio available"}
        audio_path = os.path.join(AUDIO_DIR, entry["audio_file"])
        if not os.path.exists(audio_path):
            return {"success": False, "error": "Audio file expired"}
        try:
            with open(audio_path, "rb") as f:
                audio_data = base64.b64encode(f.read()).decode("ascii")
            return {"success": True, "data": audio_data, "mime": "audio/ogg"}
        except Exception as e:
            return {"success": False, "error": str(e)}

    def _cleanup_expired_audio(self):
        """Delete audio files older than retention period."""
        retention_hours = self._settings.get("audio_retention_hours", 24)
        if not os.path.isdir(AUDIO_DIR):
            return
        cutoff = time.time() - (retention_hours * 3600)
        history = load_history()
        valid_files = {e.get("audio_file") for e in history if e.get("audio_file")}
        # Delete orphaned or expired files
        for fname in os.listdir(AUDIO_DIR):
            fpath = os.path.join(AUDIO_DIR, fname)
            if fname not in valid_files or os.path.getmtime(fpath) < cutoff:
                try:
                    os.remove(fpath)
                except Exception:
                    pass
        # Strip stale audio_file references from history entries
        changed = False
        for entry in history:
            af = entry.get("audio_file")
            if af and not os.path.exists(os.path.join(AUDIO_DIR, af)):
                del entry["audio_file"]
                changed = True
        if changed:
            persist_history(history)

    # ------------------------------------------------------------------
    # Onboarding
    # ------------------------------------------------------------------

    def check_onboarding(self) -> dict:
        downloaded = model_manager.get_downloaded_models()
        return {
            "needs_setup": len(downloaded) == 0,
            "downloaded_models": downloaded,
        }
