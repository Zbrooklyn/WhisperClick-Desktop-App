"""WhisperClick structured logging.

Writes to ~/.config/whisperclick/whisperclick.log with rotation.
Console output only when WHISPERCLICK_DEBUG=1 environment variable is set.
"""

import logging
import os
from logging.handlers import RotatingFileHandler

from src.backend.config import CONFIG_DIR

LOG_FILE = os.path.join(CONFIG_DIR, "whisperclick.log")
_MAX_BYTES = 5 * 1024 * 1024  # 5 MB
_BACKUP_COUNT = 2
_FORMAT = "[%(asctime)s] [%(levelname)s] [%(name)s] %(message)s"
_DATE_FORMAT = "%Y-%m-%d %H:%M:%S"

_initialized = False


def _init():
    global _initialized
    if _initialized:
        return
    _initialized = True

    os.makedirs(CONFIG_DIR, exist_ok=True)

    root = logging.getLogger("whisperclick")
    root.setLevel(logging.DEBUG)

    # Rotating file handler — always active
    fh = RotatingFileHandler(LOG_FILE, maxBytes=_MAX_BYTES, backupCount=_BACKUP_COUNT, encoding="utf-8")
    fh.setLevel(logging.DEBUG)
    fh.setFormatter(logging.Formatter(_FORMAT, datefmt=_DATE_FORMAT))
    root.addHandler(fh)

    # Console handler — only in debug mode
    if os.environ.get("WHISPERCLICK_DEBUG") == "1":
        ch = logging.StreamHandler()
        ch.setLevel(logging.DEBUG)
        ch.setFormatter(logging.Formatter(_FORMAT, datefmt=_DATE_FORMAT))
        root.addHandler(ch)


def get(name: str) -> logging.Logger:
    """Return a child logger under the whisperclick namespace."""
    _init()
    return logging.getLogger(f"whisperclick.{name}")
