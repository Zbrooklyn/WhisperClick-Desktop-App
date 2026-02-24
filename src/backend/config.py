import json
import os
import shutil
import sys
import uuid
from datetime import UTC, datetime, timedelta

from dotenv import load_dotenv

load_dotenv()

# Logger is imported lazily to avoid circular dependency at module load time
_log = None


def _get_log():
    global _log
    if _log is None:
        from src.backend.logger import get as get_logger

        _log = get_logger("config")
    return _log


# Installed EXE (frozen) uses "whisperclick"; running from source uses "whisperclick-dev"
# so dev/test runs never touch real user data.
_CONFIG_FOLDER = "whisperclick" if getattr(sys, "frozen", False) else "whisperclick-dev"
CONFIG_DIR = os.path.join(os.path.expanduser("~"), ".config", _CONFIG_FOLDER)
SETTINGS_FILE = os.path.join(CONFIG_DIR, "settings.json")
HISTORY_FILE = os.path.join(CONFIG_DIR, "history.json")
AUDIO_DIR = os.path.join(CONFIG_DIR, "audio")

_OLD_CONFIG_DIR = os.path.join(os.path.expanduser("~"), ".config", "whisper-stt")


def _migrate_config():
    """Copy settings.json and history.json from old ~/.config/whisper-stt/
    to new ~/.config/whisperclick/ if the old dir exists and the new one doesn't."""
    if os.path.isdir(_OLD_CONFIG_DIR) and not os.path.isdir(CONFIG_DIR):
        os.makedirs(CONFIG_DIR, exist_ok=True)
        for filename in ("settings.json", "history.json"):
            old_file = os.path.join(_OLD_CONFIG_DIR, filename)
            new_file = os.path.join(CONFIG_DIR, filename)
            if os.path.isfile(old_file):
                shutil.copy2(old_file, new_file)


_migrate_config()

OPENAI_API_KEY = os.getenv("OPENAI_API_KEY", "")
SAMPLE_RATE = 16000
CHANNELS = 1

DEFAULT_SETTINGS = {
    "mode": "local",
    "model": "base",
    "language": "auto",
    "theme": "dark",
    "auto_copy": False,
    "start_with_windows": False,
    "hotkey": "Ctrl+Alt+R",
    "close_behavior": "tray",  # "tray" = minimize to tray, "quit" = exit app
    "sound_enabled": True,  # play tones on start/stop/success/error
    "always_on_top": False,  # keep main window on top
    "show_pill_widget": False,  # floating mini widget when minimized
    "output_mode": "both",  # transcribe / translate / both
    "target_language": "en",  # target language for translation
    "source_language": "auto",  # source language hint for translation
    "pill_monitor": "auto",  # "auto" = follow cursor, or monitor index (0, 1, ...)
    "auto_copy_target": "translation",  # what auto-paste copies: "transcript", "translation", "both"
    "audio_retention_hours": 24,  # hours to keep recorded audio (0 = don't save)
}

LANGUAGES = [
    {"code": "auto", "name": "Auto Detect"},
    {"code": "en", "name": "English"},
    {"code": "es", "name": "Spanish"},
    {"code": "fr", "name": "French"},
    {"code": "de", "name": "German"},
    {"code": "ja", "name": "Japanese"},
    {"code": "zh", "name": "Chinese"},
    {"code": "ko", "name": "Korean"},
    {"code": "pt", "name": "Portuguese"},
    {"code": "it", "name": "Italian"},
    {"code": "ru", "name": "Russian"},
    {"code": "ar", "name": "Arabic"},
    {"code": "hi", "name": "Hindi"},
]


def load_settings():
    os.makedirs(CONFIG_DIR, exist_ok=True)
    if os.path.exists(SETTINGS_FILE):
        try:
            with open(SETTINGS_FILE) as f:
                saved = json.load(f)
            if not isinstance(saved, dict):
                raise ValueError(f"settings.json root is {type(saved).__name__}, expected dict")
            # Merge with defaults so new keys are included
            return {**DEFAULT_SETTINGS, **saved}
        except (json.JSONDecodeError, ValueError, UnicodeDecodeError) as exc:
            _get_log().error("Corrupt settings.json — returning defaults: %s", exc)
            return DEFAULT_SETTINGS.copy()
    return DEFAULT_SETTINGS.copy()


def save_settings(settings):
    os.makedirs(CONFIG_DIR, exist_ok=True)
    with open(SETTINGS_FILE, "w") as f:
        json.dump(settings, f, indent=2)


def _create_demo_history():
    """Generate onboarding history entries for first-run experience.

    Each entry looks like a transcription but actually walks the user through
    setup. Newest entry (top of list) is the welcome message. Users can delete
    these as they go, just like real history cards.
    """
    now = datetime.now(UTC)
    # Ordered newest-first (top of history = first thing user sees)
    demos = [
        {
            "text": (
                "Welcome to WhisperClick! This is your transcription history. "
                "Everything you dictate shows up here. "
                "These cards are here to help you get started — delete them anytime."
            ),
            "duration": 5.0,
            "transcription_time": 0.0,
            "minutes_ago": 1,
        },
        {
            "text": (
                "Step 1: Open Settings (click the gear icon in the top right). "
                "Pick Local mode to transcribe offline, or API mode to use "
                "OpenAI or Google Gemini. Local mode keeps your audio on your machine."
            ),
            "duration": 7.0,
            "transcription_time": 0.0,
            "minutes_ago": 2,
        },
        {
            "text": (
                "Step 2: Try your first recording. Press Ctrl+Shift+R (or whatever "
                "hotkey you set). Talk normally, then press it again to stop. "
                "Your words get transcribed and pasted wherever your cursor is."
            ),
            "duration": 6.0,
            "transcription_time": 0.0,
            "minutes_ago": 3,
        },
        {
            "text": (
                "Step 3: See that small pill at the top of your screen? That's your "
                "recording indicator. It shows a live timer while you talk. "
                "Right-click it to change your microphone, language, or view past transcriptions."
            ),
            "duration": 6.5,
            "transcription_time": 0.0,
            "minutes_ago": 4,
        },
        {
            "text": (
                "You're all set. Go ahead and clear these cards whenever you're ready. "
                "If you need to change your hotkey, switch providers, or download a "
                "local model, it's all in Settings. Happy dictating!"
            ),
            "duration": 5.5,
            "transcription_time": 0.0,
            "minutes_ago": 5,
        },
    ]
    entries = []
    for d in demos:
        entries.append(
            {
                "id": str(uuid.uuid4()),
                "text": d["text"],
                "timestamp": (now - timedelta(minutes=d["minutes_ago"])).isoformat(),
                "duration": d["duration"],
                "transcription_time": d["transcription_time"],
                "demo": True,
            }
        )
    return entries


def load_history():
    os.makedirs(CONFIG_DIR, exist_ok=True)
    if os.path.exists(HISTORY_FILE):
        try:
            with open(HISTORY_FILE) as f:
                data = json.load(f)
            if not isinstance(data, list):
                raise ValueError(f"history.json root is {type(data).__name__}, expected list")
            return data
        except (json.JSONDecodeError, ValueError, UnicodeDecodeError) as exc:
            _get_log().error("Corrupt history.json — returning empty list: %s", exc)
            return []
    # First run — seed with demo history
    demo = _create_demo_history()
    save_history(demo)
    return demo


def save_history(history):
    os.makedirs(CONFIG_DIR, exist_ok=True)
    with open(HISTORY_FILE, "w") as f:
        json.dump(history, f, indent=2)
