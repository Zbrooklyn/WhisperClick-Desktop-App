"""
WhisperClick Python Sidecar Engine
Communicates with Electron via stdin/stdout JSON protocol.

Commands:
  ping, quit, list_mics, set_mic, start_rec, stop_rec, cancel,
  configure, set_mode, set_language, set_model, set_api_credentials,
  set_sound_enabled, set_output_mode, set_target_language, set_source_language,
  list_models, download_model, delete_model, get_languages, translate,
  verify_key, capture_fg, paste
  (premium builds add more commands via the premium plugins/handlers.)

Events (sidecar -> Electron):
  ready, level, transcription, translation, cancelled, error,
  model_download_progress
"""

import json
import os
import re
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
# SAMPLE_RATE / CHANNELS drive the Pro capture loops (live streaming, continuous
# VAD, and meeting mode). They were referenced but never imported before, which
# would NameError the moment one of those loops ran; importing them here fixes
# that and lets meeting mode size its chunks.
from backend.config import AUDIO_DIR, CHANNELS, LANGUAGES, SAMPLE_RATE
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

# --- Pro feature flags (config-driven; inert until the host sets the key) ---
_live_streaming = False       # emit partial_transcript events while recording
_continuous_listening = False # allow the always-on VAD listener to be started

# Live-streaming worker (feature 1). Inert unless _live_streaming is on AND the
# transcriber is in local mode — API mode falls back to one-shot transcription.
_streaming_active = False
_stream_thread = None
STREAM_INTERVAL = 1.5     # seconds between incremental partial transcriptions
STREAM_MIN_SECONDS = 0.7  # don't transcribe until at least this much audio exists

# Continuous-listening / VAD worker (feature 2). Never touches the mic unless
# start_continuous is called while _continuous_listening is enabled.
_continuous_active = False
_continuous_thread = None
_vad_model = None

# Meeting-capture state. These flags stay inert (always False) in the free
# build — the meeting feature code (loop, summarization, handlers) ships only
# in the premium build and is stripped out below. Kept here so the shared
# lifecycle handlers that reference them stay valid.
_meeting_mode = False
_meeting_active = False
_meeting_thread = None
MEETING_CHUNK_SECONDS = 30      # transcribe the buffer in 30s windows
MEETING_MIN_FLUSH_SECONDS = 1.0 # ignore a trailing scrap shorter than this

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
# Plugin system (Pro features)
#
# At startup we import every module under ./plugins (except __init__) and call
# its register(hooks) to collect three optional callbacks. Everything is
# fail-safe: a broken or missing plugin is logged and skipped, and the base
# engine keeps working. Hooks:
#   on_configure(msg, transcriber)  — called inside `configure`
#   before_transcribe(transcriber)  — called just before transcriber.transcribe
#   after_transcribe(text, extra)   — called just after; may transform text and
#                                     attach segments (returns str or dict)
# ---------------------------------------------------------------------------

_PLUGIN_HOOKS = {"on_configure": [], "before_transcribe": [], "after_transcribe": []}


def _load_plugins():
    """Import plugins and register their hooks (never raises).

    Scans two packages:
      plugins          — free plugins, if any.
      premium.plugins  — Pro plugins. The whole shared/engine/premium/ dir is
                         stripped from the free/open-source build, so there the
                         import simply fails and nothing Pro is loaded — that is
                         how the free build ships with no premium engine code.
    """
    import importlib
    import pkgutil

    for pkg_name in ("plugins", "premium.plugins"):
        try:
            pkg = importlib.import_module(pkg_name)
        except Exception as e:
            # Absent package is normal (free build has no premium.plugins).
            _log.info("Plugin package '%s' not present, skipping: %s", pkg_name, e)
            continue
        for _finder, name, _ispkg in pkgutil.iter_modules(pkg.__path__):
            if name == "__init__":
                continue
            try:
                mod = importlib.import_module(f"{pkg_name}.{name}")
                register = getattr(mod, "register", None)
                if not callable(register):
                    _log.warning("Plugin '%s' has no register(hooks); skipping", name)
                    continue
                hooks = {}
                register(hooks)
                for key in _PLUGIN_HOOKS:
                    cb = hooks.get(key)
                    if callable(cb):
                        _PLUGIN_HOOKS[key].append(cb)
                _log.info("Loaded plugin: %s.%s", pkg_name, name)
            except Exception as e:
                _log.error("Failed to load plugin '%s': %s", name, e, exc_info=True)


def _run_on_configure(msg, tr):
    for cb in _PLUGIN_HOOKS["on_configure"]:
        try:
            cb(msg, tr)
        except Exception as e:
            _log.error("on_configure hook failed: %s", e, exc_info=True)


def _run_before_transcribe(tr):
    for cb in _PLUGIN_HOOKS["before_transcribe"]:
        try:
            cb(tr)
        except Exception as e:
            _log.error("before_transcribe hook failed: %s", e, exc_info=True)


def _run_after_transcribe(text, extra):
    """Let each plugin transform text / attach segments. Returns final text.

    A plugin may return a plain str (new text) or a dict {"text","segments"}.
    Segments land in `extra["segments"]` for the caller to emit.
    """
    for cb in _PLUGIN_HOOKS["after_transcribe"]:
        try:
            result = cb(text, extra)
            if isinstance(result, str):
                text = result
            elif isinstance(result, dict):
                if isinstance(result.get("text"), str):
                    text = result["text"]
                if "segments" in result:
                    extra["segments"] = result["segments"]
        except Exception as e:
            _log.error("after_transcribe hook failed: %s", e, exc_info=True)
    return text


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
            _run_before_transcribe(transcriber)
            text = transcriber.transcribe(audio)
            extra = {
                "segments": getattr(transcriber, "last_segments", None),
                "words": getattr(transcriber, "last_words", None),
            }
            text = _run_after_transcribe(text, extra)
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

        event = {
            "text": text,
            "duration": round(duration, 1),
            "transcription_time": round(elapsed, 2),
            "provider": provider,
            "model": model,
            "language": transcriber.detected_language or "auto",
            "audio_file": audio_file,
        }
        if extra.get("segments"):
            event["segments"] = extra["segments"]
        if extra.get("words"):
            event["words"] = extra["words"]
        send_event("transcription", event)

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


# ---------------------------------------------------------------------------
# Live streaming transcription (feature 1)
#
# While a normal recording is in flight, periodically transcribe the growing
# audio buffer and emit `partial_transcript` events so the host can show text
# resolving live. On stop, the usual one-shot `transcription` event still fires
# (this worker only previews; it never replaces the final result). Degrade-safe:
# only runs in local mode, and any failure quietly ends the previews while the
# recording — and its final transcription — continue untouched.
# ---------------------------------------------------------------------------


def _stream_loop():
    """Emit incremental partial_transcript events during a recording."""
    import numpy as np

    last_emitted = ""
    min_samples = int(SAMPLE_RATE * STREAM_MIN_SECONDS)
    while _streaming_active and _recording:
        time.sleep(STREAM_INTERVAL)
        if not (_streaming_active and _recording):
            break
        try:
            audio = recorder.get_audio_numpy()
            if audio is None or len(audio) < min_samples:
                continue
            snapshot = np.array(audio, copy=True)
            with _transcriber_lock:
                if not (_streaming_active and _recording):
                    break
                if transcriber.is_cancel_requested():
                    break
                text = transcriber.transcribe(snapshot)
            if text and text != last_emitted:
                last_emitted = text
                send_event("partial_transcript", {"text": text})
        except TranscriptionCancelled:
            break
        except Exception:
            # Degrade-safe: stop previewing but leave the recording (and its
            # final one-shot transcription) running.
            _log.debug("Streaming partial failed; ending live previews", exc_info=True)
            break


def _stop_streaming():
    """Stop the streaming worker (if any) and wait for it to finish."""
    global _streaming_active, _stream_thread
    _streaming_active = False
    if _stream_thread is not None:
        _stream_thread.join(timeout=3)
        _stream_thread = None


# ---------------------------------------------------------------------------
# Continuous listening / VAD (feature 2)
#
# An always-on listener driven by Silero VAD: it opens its own input stream,
# auto-starts capturing on detected speech, auto-stops on trailing silence, and
# emits one `transcription` event per utterance. It is OFF unless start_continuous
# is called while `continuous_listening` is enabled, and is fully stoppable via
# stop_continuous. All heavy imports (torch, sounddevice, silero) are lazy so the
# base engine and py_compile never need them.
# ---------------------------------------------------------------------------

VAD_FRAME = 512               # samples per VAD frame (~32ms at 16 kHz)
VAD_SPEECH_THRESHOLD = 0.5    # Silero speech probability to count as speech
VAD_SILENCE_SECONDS = 0.8     # trailing silence that ends an utterance
VAD_MIN_UTTERANCE_SECONDS = 0.3  # ignore blips shorter than this


def _load_vad():
    """Load the Silero VAD model (cached). Raises if it can't be loaded."""
    global _vad_model
    if _vad_model is not None:
        return _vad_model
    # Prefer the bundled pip package API; fall back to torch.hub.
    try:
        from silero_vad import load_silero_vad
        _vad_model = load_silero_vad()
        return _vad_model
    except Exception:
        _log.debug("silero_vad package unavailable, trying torch.hub", exc_info=True)
    import torch
    model, _utils = torch.hub.load(
        repo_or_dir="snakers4/silero-vad", model="silero_vad", trust_repo=True
    )
    _vad_model = model
    return _vad_model


def _vad_prob(model, frame):
    """Speech probability for one VAD frame (numpy float32, VAD_FRAME samples)."""
    import torch

    with torch.no_grad():
        return float(model(torch.from_numpy(frame), SAMPLE_RATE))


def _emit_utterance(audio):
    """Transcribe one detected utterance and emit a `transcription` event."""
    try:
        with _transcriber_lock:
            transcriber.clear_cancel_request()
            _run_before_transcribe(transcriber)
            text = transcriber.transcribe(audio)
            extra = {
                "segments": getattr(transcriber, "last_segments", None),
                "words": getattr(transcriber, "last_words", None),
            }
            text = _run_after_transcribe(text, extra)
    except TranscriptionCancelled:
        return
    except Exception as e:
        _log.error("Continuous transcription failed: %s", e, exc_info=True)
        send_event("error", {"message": str(e)})
        return
    if not text or not text.strip():
        return
    provider = transcriber._api_provider if transcriber.mode == "api" else "local"
    model = transcriber._api_model if transcriber.mode == "api" else transcriber._model_name
    event = {
        "text": text,
        "provider": provider,
        "model": model,
        "language": transcriber.detected_language or "auto",
        "continuous": True,
    }
    if extra.get("segments"):
        event["segments"] = extra["segments"]
    if extra.get("words"):
        event["words"] = extra["words"]
    send_event("transcription", event)


def _continuous_loop():
    """Always-on VAD listen loop: one transcription event per utterance."""
    import queue

    import numpy as np
    import sounddevice as sd

    try:
        model = _load_vad()
    except Exception as e:
        _log.error("Continuous listening could not load VAD: %s", e, exc_info=True)
        send_event("error", {"message": f"Voice detection unavailable: {e}"})
        _mark_continuous_stopped()
        return

    q = queue.Queue()

    def _cb(indata, frames, time_info, status):
        q.put(indata.copy())

    silence_frames_limit = max(1, int(VAD_SILENCE_SECONDS / (VAD_FRAME / SAMPLE_RATE)))
    min_utt_samples = int(SAMPLE_RATE * VAD_MIN_UTTERANCE_SECONDS)

    speech = []
    in_speech = False
    silence_count = 0
    pending = np.empty((0,), dtype=np.float32)

    try:
        if hasattr(model, "reset_states"):
            model.reset_states()
        with sd.InputStream(samplerate=SAMPLE_RATE, channels=CHANNELS,
                            dtype="float32", blocksize=VAD_FRAME, callback=_cb):
            send_event("continuous_status", {"listening": True})
            while _continuous_active:
                try:
                    chunk = q.get(timeout=0.1)
                except queue.Empty:
                    continue
                pending = np.concatenate([pending, chunk.reshape(-1)])
                while len(pending) >= VAD_FRAME and _continuous_active:
                    frame = pending[:VAD_FRAME]
                    pending = pending[VAD_FRAME:]
                    try:
                        prob = _vad_prob(model, frame)
                    except Exception:
                        _log.debug("VAD frame scoring failed", exc_info=True)
                        prob = 0.0
                    if prob >= VAD_SPEECH_THRESHOLD:
                        in_speech = True
                        silence_count = 0
                        speech.append(frame)
                    elif in_speech:
                        silence_count += 1
                        speech.append(frame)
                        if silence_count >= silence_frames_limit:
                            utterance = np.concatenate(speech)
                            speech = []
                            in_speech = False
                            silence_count = 0
                            if hasattr(model, "reset_states"):
                                model.reset_states()
                            if len(utterance) >= min_utt_samples:
                                _emit_utterance(utterance)
    except Exception as e:
        _log.error("Continuous listening loop error: %s", e, exc_info=True)
        send_event("error", {"message": f"Continuous listening stopped: {e}"})
    finally:
        _mark_continuous_stopped()
        send_event("continuous_status", {"listening": False})


def _mark_continuous_stopped():
    global _continuous_active
    _continuous_active = False




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


def _do_transcribe_file(msg_id, path):
    """Transcribe an audio file at `path` and emit a normal transcription event.

    Decodes the file with soundfile into a WAV buffer (downmixed to mono) and
    feeds it through the existing transcribe paths, so both local and API modes
    and all Pro plugin hooks apply. Emits a `transcription` event with an extra
    `"source": "file"`.
    """
    try:
        if not path or not os.path.isfile(path):
            send_event("error", {"message": f"Audio file not found: {path}"})
            send_error(msg_id, "Audio file not found")
            return

        import io

        import numpy as np
        import soundfile as sf

        data, sr = sf.read(path, dtype="float32")
        if getattr(data, "ndim", 1) > 1:  # downmix stereo/multi to mono
            data = data.mean(axis=1)
        duration = round(len(data) / float(sr), 1) if sr else 0.0

        # A WAV buffer works for both modes: local writes it to a temp file
        # (faster-whisper resamples), API compresses it to OGG.
        buf = io.BytesIO()
        sf.write(buf, data, sr, format="WAV", subtype="PCM_16")
        buf.seek(0)

        start_time = time.time()
        with _transcriber_lock:
            _run_before_transcribe(transcriber)
            text = transcriber.transcribe(buf)
            extra = {
                "segments": getattr(transcriber, "last_segments", None),
                "words": getattr(transcriber, "last_words", None),
            }
            text = _run_after_transcribe(text, extra)
        elapsed = time.time() - start_time

        provider = transcriber._api_provider if transcriber.mode == "api" else "local"
        model = transcriber._api_model if transcriber.mode == "api" else transcriber._model_name

        event = {
            "text": text,
            "duration": duration,
            "transcription_time": round(elapsed, 2),
            "provider": provider,
            "model": model,
            "language": transcriber.detected_language or "auto",
            "audio_file": path,
            "source": "file",
        }
        if extra.get("segments"):
            event["segments"] = extra["segments"]
        if extra.get("words"):
            event["words"] = extra["words"]
        send_event("transcription", event)
        send_ok(msg_id)
    except TranscriptionCancelled:
        send_event("cancelled", {})
        send_ok(msg_id)
    except Exception as e:
        _log.error("File transcription failed: %s", e, exc_info=True)
        send_event("error", {"message": str(e)})
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
    global _recording, _continuous_active, _meeting_active
    _continuous_active = False  # release the VAD listener / its mic
    _meeting_active = False      # release the meeting mic (worker will wind down)
    _stop_streaming()
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
    global _audio_retention_days, _live_streaming, _continuous_listening
    global _meeting_mode
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
    if "live_streaming" in msg:
        _live_streaming = bool(msg["live_streaming"])
    if "continuous_listening" in msg:
        _continuous_listening = bool(msg["continuous_listening"])
    # Let plugins absorb their own config keys (Pro features).
    _run_on_configure(msg, transcriber)
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
    global _recording, _level_thread, _streaming_active, _stream_thread
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
        # Live streaming previews (feature 1): only in local mode; API mode
        # degrades to the normal one-shot transcription on stop.
        if _live_streaming and transcriber.mode == "local":
            _streaming_active = True
            _stream_thread = threading.Thread(target=_stream_loop, daemon=True)
            _stream_thread.start()
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
    # Stop live-streaming previews before the final one-shot so they can't race
    # the transcriber lock (feature 1).
    _stop_streaming()
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


@command("pause_rec")
def _h_pause_rec(msg, msg_id):
    # Flag-only pause: the input stream stays open so resume is instant, but the
    # recorder stops buffering frames. No engine _recording change (still a take).
    paused = recorder.pause()
    send_ok(msg_id, paused=bool(paused))


@command("resume_rec")
def _h_resume_rec(msg, msg_id):
    recorder.resume()
    send_ok(msg_id, paused=bool(recorder.is_paused()))


@command("is_paused")
def _h_is_paused(msg, msg_id):
    send_ok(msg_id, paused=bool(recorder.is_paused()))


@command("cancel")
def _h_cancel(msg, msg_id):
    global _recording
    was_recording = _recording
    _recording = False
    _stop_streaming()
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


# --- Continuous listening / VAD (feature 2) ---

@command("start_continuous")
def _h_start_continuous(msg, msg_id):
    """Start the always-on VAD listener (only when continuous_listening is on)."""
    global _continuous_active, _continuous_thread
    if not _continuous_listening:
        send_error(msg_id, "Continuous listening is not enabled. "
                           "Set continuous_listening in configure first.")
        return
    if _continuous_active:
        send_ok(msg_id, listening=True, already=True)
        return
    # Prove the VAD can load before we claim we're listening; keeps the mic off
    # if voice detection is unavailable.
    try:
        _load_vad()
    except Exception as e:
        _log.error("start_continuous: VAD unavailable: %s", e, exc_info=True)
        send_error(msg_id, f"Voice detection unavailable: {e}")
        return
    _continuous_active = True
    _continuous_thread = threading.Thread(target=_continuous_loop, daemon=True)
    _continuous_thread.start()
    send_ok(msg_id, listening=True)


@command("stop_continuous")
def _h_stop_continuous(msg, msg_id):
    """Stop the always-on VAD listener; fully releases the mic."""
    global _continuous_active, _continuous_thread
    _continuous_active = False
    if _continuous_thread is not None:
        _continuous_thread.join(timeout=5)
        _continuous_thread = None
    send_ok(msg_id, listening=False)




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


# --- File transcription ---

@command("transcribe_file")
def _h_transcribe_file(msg, msg_id):
    """Transcribe an audio file off the reader thread (may be slow)."""
    path = msg.get("path", "")
    threading.Thread(
        target=_do_transcribe_file, args=(msg_id, path), daemon=True
    ).start()




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
ASYNC_COMMANDS = frozenset({
    "verify_key", "translate", "list_mics",
    "start_continuous", "stop_continuous",
})

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
    _load_plugins()
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
