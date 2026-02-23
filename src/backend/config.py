import json
import os
import shutil

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


CONFIG_DIR = os.path.join(os.path.expanduser("~"), ".config", "whisperclick")
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
    return []


def save_history(history):
    os.makedirs(CONFIG_DIR, exist_ok=True)
    with open(HISTORY_FILE, "w") as f:
        json.dump(history, f, indent=2)
