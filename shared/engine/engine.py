"""
WhisperClick Python Sidecar Engine
Communicates with Electron via stdin/stdout JSON protocol.

Commands:
  ping, quit, list_mics, set_mic, start_rec, stop_rec, cancel,
  configure, set_mode, set_language, set_model, set_api_credentials,
  set_sound_enabled, set_output_mode, set_target_language, set_source_language,
  list_models, download_model, delete_model, get_languages, translate,
  verify_key, capture_fg, paste

Events (sidecar -> Electron):
  ready, level, transcription, translation, cancelled, error,
  model_download_progress
"""

import json
import os
import sys
import threading
import time
import urllib.error as urllib_error
import urllib.request as urllib_request

# Redirect stderr to a log file BEFORE any imports that might print to it.
# WHISPERCLICK_CONFIG_DIR overrides the location (used by tests; lets the host
# point the engine at its own config dir). Mirror config.py's dev/prod split so a
# from-source run logs to "whisperclick-dev", never the installed app's folder.
_frozen = getattr(sys, "frozen", False)
_log_dir = os.environ.get("WHISPERCLICK_CONFIG_DIR") or os.path.join(
    os.path.expanduser("~"), ".config", "whisperclick" if _frozen else "whisperclick-dev"
)
os.makedirs(_log_dir, exist_ok=True)
_engine_log = os.path.join(_log_dir, "engine.log")
# Cap the raw-stderr log so it can't grow unbounded (R9): rotate at 5 MB, keeping
# one previous file. Mirrors the Electron debug-log policy. Best-effort — if the
# file is held open by another process (e.g. an installed instance), the rename
# fails harmlessly and we just append.
try:
    if os.path.getsize(_engine_log) >= 5 * 1024 * 1024:
        _rotated = _engine_log + ".1"
        try:
            os.remove(_rotated)
        except OSError:
            pass
        os.replace(_engine_log, _rotated)
except OSError:
    pass
sys.stderr = open(_engine_log, "a")

# Now import backend modules (they log to file, not stdout)
from backend.audio_recorder import AudioRecorder
from backend.config import AUDIO_DIR, LANGUAGES
from backend.logger import get as get_logger
from backend.transcription import TranscriptionCancelled, TranscriptionService
from backend import models
from backend import tones
from backend.api_requests import build_verify_request, redact_key
from backend.concurrency import OperationTimeout, run_with_timeout
from backend.ids import make_audio_id

_log = get_logger("engine")


# ---------------------------------------------------------------------------
# JSON protocol
# ---------------------------------------------------------------------------

_stdout_lock = threading.Lock()


def send(msg):
    """Send a JSON message to Electron via stdout (thread-safe)."""
    with _stdout_lock:
        sys.stdout.write(json.dumps(msg) + "\n")
        sys.stdout.flush()


def send_event(event, data=None):
    """Send an event (no id) to Electron."""
    msg = {"event": event}
    if data is not None:
        msg["data"] = data
    send(msg)


def send_response(msg_id, **kwargs):
    """Send a response to a command."""
    send({"id": msg_id, **kwargs})


def send_ok(msg_id, **kwargs):
    send_response(msg_id, status="ok", **kwargs)


def send_error(msg_id, error):
    send_response(msg_id, status="error", error=str(error))


# ---------------------------------------------------------------------------
# Engine state
# ---------------------------------------------------------------------------

recorder = AudioRecorder()
transcriber = TranscriptionService()

_recording = False
_level_thread = None
_sound_enabled = True
_output_mode = "transcribe"  # transcribe | translate | both
_target_language = "en"
_source_language = "auto"
_audio_retention_days = 30
_paste_target_hwnd = None  # Foreground window captured before recording

# Serializes access to the shared transcriber. The local faster-whisper model is
# not thread-safe, and a standalone `translate` now runs on its own thread, so it
# must not race an in-flight transcription/translation. RLock so the same thread
# can re-enter if a future code path nests transcriber calls.
_transcriber_lock = threading.RLock()

# Serializes the recording lifecycle (start/stop/cancel/set_mic), which now run
# off the reader thread, so they can't corrupt recorder/_recording state by
# interleaving. Separate from the transcriber lock.
_recording_lock = threading.RLock()

# Bound how long opening the audio device may take. A stale/disconnected device
# can make PortAudio hang; without this the engine waits on the host's outer 60s
# cap. (R3)
DEVICE_OPEN_TIMEOUT = 8


def _level_poll_loop():
    """Send real audio levels during recording at ~20 Hz."""
    while _recording:
        level = recorder.get_level()
        send_event("level", {"level": round(level, 3)})
        time.sleep(0.05)


def _cleanup_expired_audio():
    """Delete audio files older than the configured retention period."""
    if _audio_retention_days == 0:
        return  # "Forever" — never delete
    if not os.path.isdir(AUDIO_DIR):
        return
    cutoff = time.time() - (_audio_retention_days * 86400)
    for fname in os.listdir(AUDIO_DIR):
        fpath = os.path.join(AUDIO_DIR, fname)
        if not os.path.isfile(fpath):
            continue
        try:
            if os.path.getmtime(fpath) < cutoff:
                os.remove(fpath)
                _log.info("Deleted expired audio: %s", fname)
        except OSError:
            pass


# ---------------------------------------------------------------------------
# Transcription / translation background worker
# ---------------------------------------------------------------------------


def _do_transcribe(duration):
    """Run transcription (+ optional translation) and send results as events."""
    try:
        # Get audio in the best format for the current mode
        if transcriber.mode == "local":
            audio = recorder.get_audio_numpy()
        else:
            audio = recorder.get_wav_bytes()

        if audio is None:
            send_event("error", {"message": "No audio data captured"})
            return

        start_time = time.time()
        with _transcriber_lock:
            text = transcriber.transcribe(audio)
        elapsed = time.time() - start_time

        if _sound_enabled:
            try:
                tones.play_success_tone()
            except Exception:
                pass

        provider = transcriber._api_provider if transcriber.mode == "api" else "local"
        model = transcriber._api_model if transcriber.mode == "api" else transcriber._model_name

        # Save audio for playback
        audio_file = None
        try:
            wav_bytes = recorder.get_wav_bytes()
            if wav_bytes is not None:
                import soundfile as sf

                os.makedirs(AUDIO_DIR, exist_ok=True)
                audio_id = make_audio_id()
                out_path = os.path.join(AUDIO_DIR, f"{audio_id}.ogg")
                data, sr = sf.read(wav_bytes, dtype="float32")
                sf.write(out_path, data, sr, format="OGG", subtype="OPUS")
                audio_file = out_path
        except Exception:
            _log.debug("Failed to save audio recording", exc_info=True)

        send_event("transcription", {
            "text": text,
            "duration": round(duration, 1),
            "transcription_time": round(elapsed, 2),
            "provider": provider,
            "model": model,
            "language": transcriber.detected_language or "auto",
            "audio_file": audio_file,
        })

        # Translation if output_mode includes it
        if _output_mode in ("translate", "both") and text.strip():
            try:
                with _transcriber_lock:
                    translated = transcriber.translate(text, _target_language, _source_language)
                send_event("translation", {
                    "text": translated,
                    "source": text,
                    "target_language": _target_language,
                    "source_language": _source_language,
                })
            except TranscriptionCancelled:
                pass
            except Exception as e:
                _log.error("Translation failed: %s", e, exc_info=True)
                send_event("error", {"message": f"Translation failed: {e}"})

    except TranscriptionCancelled:
        if _sound_enabled:
            try:
                tones.play_cancel_tone()
            except Exception:
                pass
        send_event("cancelled", {})
    except Exception as e:
        _log.error("Transcription failed: %s", e, exc_info=True)
        if _sound_enabled:
            try:
                tones.play_error_tone()
            except Exception:
                pass
        send_event("error", {"message": str(e)})


def _do_paste(msg_id, wc_focused):
    """Restore focus to the saved target window and simulate Ctrl+V.

    Mirrors V3's _auto_paste strategy:
    - If WhisperClick is focused and a target was captured → SetForegroundWindow + Ctrl+V
    - If WhisperClick is focused and no target → skip (clipboard only)
    - If a target app is already focused → just Ctrl+V
    """
    try:
        import ctypes

        if wc_focused:
            if not _paste_target_hwnd:
                send_ok(msg_id)
                return
            ctypes.windll.user32.SetForegroundWindow(_paste_target_hwnd)
            time.sleep(0.08)

        VK_CONTROL, VK_V, KEYEVENTF_KEYUP = 0x11, 0x56, 0x02
        ctypes.windll.user32.keybd_event(VK_CONTROL, 0, 0, 0)
        ctypes.windll.user32.keybd_event(VK_V, 0, 0, 0)
        ctypes.windll.user32.keybd_event(VK_V, 0, KEYEVENTF_KEYUP, 0)
        ctypes.windll.user32.keybd_event(VK_CONTROL, 0, KEYEVENTF_KEYUP, 0)
    except Exception:
        _log.debug("paste failed", exc_info=True)
    send_ok(msg_id)


def _do_download_model(msg_id, model_name):
    """Download model with progress events."""
    def progress_cb(current, total):
        send_event("model_download_progress", {
            "model": model_name,
            "current": current,
            "total": total,
        })

    try:
        models.download_model(model_name, progress_callback=progress_cb)
        send_ok(msg_id)
    except Exception as e:
        _log.error("Model download failed: %s", e, exc_info=True)
        send_error(msg_id, e)


# ---------------------------------------------------------------------------
# Command dispatch
# ---------------------------------------------------------------------------


# ---------------------------------------------------------------------------
# Command handlers
#
# Each handler is `fn(msg, msg_id)` and is registered in _HANDLERS via @command.
# handle_command() is a thin lookup+dispatch over this table, so each command is
# a small, individually testable unit instead of one ~320-line if/elif chain.
# ---------------------------------------------------------------------------

_HANDLERS = {}


def command(name):
    """Register the decorated function as the handler for `name`."""
    def register(fn):
        _HANDLERS[name] = fn
        return fn
    return register


# --- Lifecycle ---

@command("ping")
def _h_ping(msg, msg_id):
    send_ok(msg_id, pong=True, version="2.0.0")


@command("quit")
def _h_quit(msg, msg_id):
    global _recording
    if _recording:
        _recording = False
        try:
            recorder.stop()
        except Exception:
            pass
    send_ok(msg_id)
    sys.exit(0)


# --- Configuration ---

@command("configure")
def _h_configure(msg, msg_id):
    """Apply all settings at once (sent by Electron after sidecar ready)."""
    global _sound_enabled, _output_mode, _target_language, _source_language
    global _audio_retention_days
    if "mode" in msg:
        transcriber.set_mode(msg["mode"])
    if "language" in msg:
        transcriber.set_language(msg["language"])
    if "model" in msg:
        transcriber.set_model(msg["model"])
    if "provider" in msg or "api_key" in msg:
        transcriber.set_api_credentials(
            msg.get("provider", "openai"),
            msg.get("api_key", ""),
            msg.get("base_url", ""),
        )
    if "api_model" in msg:
        transcriber.set_api_model(msg["api_model"])
    if "sound_enabled" in msg:
        _sound_enabled = msg["sound_enabled"]
        tones.set_enabled(_sound_enabled)
    if "output_mode" in msg:
        _output_mode = msg["output_mode"]
    if "target_language" in msg:
        _target_language = msg["target_language"]
    if "source_language" in msg:
        _source_language = msg["source_language"]
    if "audio_retention_days" in msg:
        _audio_retention_days = msg["audio_retention_days"]
    # Audio cleanup scans/deletes files on disk; run it off the reader thread so
    # `configure` returns immediately and a large audio dir can't add latency (R7).
    threading.Thread(target=_cleanup_expired_audio, daemon=True).start()
    send_ok(msg_id)


@command("set_mode")
def _h_set_mode(msg, msg_id):
    transcriber.set_mode(msg.get("mode", "api"))
    send_ok(msg_id)


@command("set_language")
def _h_set_language(msg, msg_id):
    transcriber.set_language(msg.get("language", "auto"))
    send_ok(msg_id)


@command("set_model")
def _h_set_model(msg, msg_id):
    transcriber.set_model(msg.get("model", "base"))
    send_ok(msg_id)


@command("set_api_credentials")
def _h_set_api_credentials(msg, msg_id):
    transcriber.set_api_credentials(
        msg.get("provider", "openai"),
        msg.get("api_key", ""),
        msg.get("base_url", ""),
    )
    if msg.get("api_model"):
        transcriber.set_api_model(msg["api_model"])
    send_ok(msg_id)


@command("set_sound_enabled")
def _h_set_sound_enabled(msg, msg_id):
    global _sound_enabled
    _sound_enabled = msg.get("enabled", True)
    tones.set_enabled(_sound_enabled)
    send_ok(msg_id)


@command("set_output_mode")
def _h_set_output_mode(msg, msg_id):
    global _output_mode
    _output_mode = msg.get("output_mode", "transcribe")
    send_ok(msg_id)


@command("set_target_language")
def _h_set_target_language(msg, msg_id):
    global _target_language
    _target_language = msg.get("target_language", "en")
    send_ok(msg_id)


@command("set_source_language")
def _h_set_source_language(msg, msg_id):
    global _source_language
    _source_language = msg.get("source_language", "auto")
    send_ok(msg_id)


# --- Microphone ---

@command("list_mics")
def _h_list_mics(msg, msg_id):
    try:
        mics = AudioRecorder.list_devices()
        send_ok(msg_id, mics=mics)
    except Exception as e:
        send_error(msg_id, e)


@command("set_mic")
def _h_set_mic(msg, msg_id):
    device_id = msg.get("device_id")
    try:
        recorder.set_device(device_id)
        send_ok(msg_id)
    except Exception as e:
        send_error(msg_id, e)


# --- Recording ---

@command("start_rec")
def _h_start_rec(msg, msg_id):
    global _recording, _level_thread
    if _recording:
        # Main process gate should prevent this. If we get here, cancel
        # the stale recording and start fresh instead of erroring out.
        _log.warning("start_rec while already recording — cancelling stale recording")
        try:
            recorder.stop()
        except Exception:
            pass
        _recording = False
    try:
        transcriber.clear_cancel_request()
        run_with_timeout(recorder.start, DEVICE_OPEN_TIMEOUT)
        _recording = True
        _level_thread = threading.Thread(target=_level_poll_loop, daemon=True)
        _level_thread.start()
        if _sound_enabled:
            try:
                tones.play_start_tone()
            except Exception:
                pass
        send_ok(msg_id)
    except OperationTimeout:
        _recording = False
        _log.error("Microphone did not respond within %ss", DEVICE_OPEN_TIMEOUT)
        send_error(msg_id, "Microphone did not respond. "
                           "Check that your input device is connected.")
    except Exception as e:
        _recording = False
        _log.error("Failed to start recording: %s", e, exc_info=True)
        send_error(msg_id, e)


@command("stop_rec")
def _h_stop_rec(msg, msg_id):
    global _recording
    if not _recording:
        _log.warning("stop_rec while not recording — ignoring")
        send_ok(msg_id, duration=0)
        return
    _recording = False
    if _level_thread:
        _level_thread.join(timeout=2)
    recorder.stop()
    duration = recorder.get_duration()
    if _sound_enabled:
        try:
            tones.play_stop_tone()
        except Exception:
            pass
    send_ok(msg_id, duration=round(duration, 1))
    # Transcribe in background
    threading.Thread(target=_do_transcribe, args=(duration,), daemon=True).start()


@command("cancel")
def _h_cancel(msg, msg_id):
    global _recording
    was_recording = _recording
    _recording = False
    transcriber.request_cancel()
    if was_recording:
        try:
            recorder.stop()
        except Exception:
            pass
        if _sound_enabled:
            try:
                tones.play_cancel_tone()
            except Exception:
                pass
    send_ok(msg_id)


# --- Translation (standalone) ---

@command("translate")
def _h_translate(msg, msg_id):
    text = msg.get("text", "")
    target = msg.get("target_language", _target_language)
    source = msg.get("source_language", _source_language)
    try:
        with _transcriber_lock:
            translated = transcriber.translate(text, target, source)
        send_ok(msg_id, text=translated)
    except Exception as e:
        send_error(msg_id, e)


# --- Models ---

@command("list_models")
def _h_list_models(msg, msg_id):
    model_list = []
    for name, info in models.MODEL_INFO.items():
        model_list.append({
            "name": name,
            "size_mb": info["size_mb"],
            "description": info["description"],
            "downloaded": models.is_model_downloaded(name),
        })
    send_ok(msg_id, models=model_list)


@command("download_model")
def _h_download_model(msg, msg_id):
    model_name = msg.get("model_name", "")
    # Long-running — respond immediately, send progress events
    threading.Thread(target=_do_download_model, args=(msg_id, model_name), daemon=True).start()


@command("delete_model")
def _h_delete_model(msg, msg_id):
    model_name = msg.get("model_name", "")
    try:
        models.delete_model(model_name)
        send_ok(msg_id)
    except Exception as e:
        send_error(msg_id, e)


# --- Info ---

@command("get_languages")
def _h_get_languages(msg, msg_id):
    send_ok(msg_id, languages=LANGUAGES)


# --- Auto-paste focus management (mirrors V3 api._auto_paste) ---

@command("capture_fg")
def _h_capture_fg(msg, msg_id):
    global _paste_target_hwnd
    try:
        import ctypes
        hwnd = ctypes.windll.user32.GetForegroundWindow()
        _paste_target_hwnd = hwnd if hwnd else None
    except Exception:
        _log.debug("capture_fg failed", exc_info=True)
    send_ok(msg_id)


@command("paste")
def _h_paste(msg, msg_id):
    _do_paste(msg_id, msg.get("wc_focused", False))


@command("press_enter")
def _h_press_enter(msg, msg_id):
    try:
        import ctypes
        VK_RETURN, KEYEVENTF_KEYUP = 0x0D, 0x02
        ctypes.windll.user32.keybd_event(VK_RETURN, 0, 0, 0)
        ctypes.windll.user32.keybd_event(VK_RETURN, 0, KEYEVENTF_KEYUP, 0)
    except Exception:
        _log.debug("press_enter failed", exc_info=True)
    send_ok(msg_id)


# --- API key verification (HTTP) ---

@command("verify_key")
def _h_verify_key(msg, msg_id):
    provider = msg.get("provider", "openai").lower()
    key = str(msg.get("api_key", "")).strip()
    base_url = str(msg.get("base_url", "")).strip().rstrip("/")

    if provider not in ("openai", "gemini"):
        send_response(msg_id, status="ok", success=False, valid=False,
                      error=f"Invalid provider: {provider}")
        return
    if not key:
        send_response(msg_id, status="ok", success=False, valid=False,
                      error="API key is required.")
        return

    if not base_url:
        if provider == "openai":
            base_url = "https://api.openai.com/v1"
        else:
            base_url = "https://generativelanguage.googleapis.com/v1beta"

    if not base_url.startswith("https://") and not base_url.startswith("http://"):
        send_response(msg_id, status="ok", success=False, valid=False,
                      error="Base URL must start with https:// or http://")
        return

    try:
        req = build_verify_request(provider, base_url, key)
        with urllib_request.urlopen(req, timeout=10) as response:
            http_status = int(getattr(response, "status", 200))
            send_response(msg_id, status="ok",
                          success=True, valid=True, http_status=http_status)
    except urllib_error.HTTPError as exc:
        http_status = int(getattr(exc, "code", 0) or 0)
        try:
            detail = exc.read(1024).decode("utf-8", errors="ignore").strip()
        except Exception:
            detail = ""
        lowered = detail.lower()

        if http_status in (401, 403):
            send_response(msg_id, status="ok",
                          success=True, valid=False, http_status=http_status,
                          error="Invalid API key.")
        elif (http_status == 400 and "api key" in lowered
              and ("not valid" in lowered or "invalid" in lowered)):
            send_response(msg_id, status="ok",
                          success=True, valid=False, http_status=http_status,
                          error="Invalid API key.")
        else:
            safe_detail = redact_key(detail, key, limit=160)
            error_msg = f"Verification failed ({http_status})."
            if safe_detail:
                error_msg = f"{error_msg} {safe_detail}"
            send_response(msg_id, status="ok",
                          success=False, valid=False, http_status=http_status,
                          error=error_msg)
    except urllib_error.URLError:
        send_response(msg_id, status="ok", success=False, valid=False,
                      error="Network error while verifying key. Check connection or base URL.")
    except Exception as exc:
        send_response(msg_id, status="ok", success=False, valid=False,
                      error=str(exc))


def handle_command(msg):
    """Thin dispatcher: look the command up in _HANDLERS and run it."""
    cmd = msg.get("command")
    msg_id = msg.get("id", 0)
    handler = _HANDLERS.get(cmd)
    if handler is None:
        send_error(msg_id, f"Unknown command: {cmd}")
        return
    handler(msg, msg_id)


# ---------------------------------------------------------------------------
# Dispatch (routing vs. execution)
# ---------------------------------------------------------------------------

# Commands that may block on network I/O or device enumeration run on their own
# daemon thread so they never stall the single stdin reader — this keeps
# lightweight commands (ping, level events) responsive while a slow command is in
# flight (the freeze the audit measured). These touch no reader-owned mutable
# state except the transcriber, which is guarded by _transcriber_lock.
ASYNC_COMMANDS = frozenset({"verify_key", "translate", "list_mics"})

# Recording lifecycle commands also run off the reader thread (so a stalled
# device open can't freeze it), but serialized under _recording_lock so they
# can't interleave and corrupt recorder/_recording state.
RECORDING_COMMANDS = frozenset({"start_rec", "stop_rec", "cancel", "set_mic"})


def _run_async(msg, lock=None):
    """Run a handler off the reader thread, reporting any escaped error.

    If a lock is given it is held for the duration so same-lane commands serialize.
    """
    try:
        if lock is not None:
            with lock:
                handle_command(msg)
        else:
            handle_command(msg)
    except Exception as e:  # pragma: no cover - defensive
        _log.error("Async handler error: %s", e, exc_info=True)
        try:
            send({"id": msg.get("id", 0), "status": "error", "error": str(e)})
        except Exception:
            pass


def dispatch(msg):
    """Route a command: recording lane (locked) and slow lane run off-thread; the
    rest run inline on the reader thread."""
    cmd = msg.get("command")
    if cmd in RECORDING_COMMANDS:
        threading.Thread(
            target=_run_async, args=(msg, _recording_lock), daemon=True
        ).start()
    elif cmd in ASYNC_COMMANDS:
        threading.Thread(target=_run_async, args=(msg,), daemon=True).start()
    else:
        handle_command(msg)


# ---------------------------------------------------------------------------
# Main loop
# ---------------------------------------------------------------------------


def main():
    _log.info("Engine starting")
    send_event("ready", {"version": "2.0.0"})

    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            msg = json.loads(line)
            dispatch(msg)
        except json.JSONDecodeError:
            send({"error": "Invalid JSON"})
        except SystemExit:
            raise
        except Exception as e:
            _log.error("Unhandled error: %s", e, exc_info=True)
            send({"error": str(e)})


if __name__ == "__main__":
    main()
