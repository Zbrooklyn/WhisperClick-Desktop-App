"""
WhisperClick sidecar configuration.

Provides config paths and constants. Settings persistence is handled
by the Electron Store — this module only defines paths and defaults
for the Python side (models directory, audio directory, etc.).
"""

import os
import sys

# Installed EXE (frozen) uses "whisperclick"; running from source uses "whisperclick-dev"
IS_FROZEN = getattr(sys, "frozen", False)
_CONFIG_FOLDER = "whisperclick" if IS_FROZEN else "whisperclick-dev"
CONFIG_DIR = os.path.join(os.path.expanduser("~"), ".config", _CONFIG_FOLDER)
MODELS_DIR = os.path.join(CONFIG_DIR, "models")
AUDIO_DIR = os.path.join(CONFIG_DIR, "audio")

os.makedirs(CONFIG_DIR, exist_ok=True)
os.makedirs(MODELS_DIR, exist_ok=True)

SAMPLE_RATE = 16000
CHANNELS = 1

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
