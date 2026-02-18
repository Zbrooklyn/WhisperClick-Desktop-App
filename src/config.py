import os
from enum import Enum
from dotenv import load_dotenv

load_dotenv()


class TranscriptionMode(Enum):
    LOCAL = "local"
    API = "api"


WHISPER_MODELS = ["tiny", "base", "small", "medium", "large"]

OPENAI_API_KEY = os.getenv("OPENAI_API_KEY", "")
WHISPER_MODEL = os.getenv("WHISPER_MODEL", "base")
HOTKEY = os.getenv("HOTKEY", "<ctrl>+<shift>+r")

SAMPLE_RATE = 16000
CHANNELS = 1
