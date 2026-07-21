"""Collision-proof id helpers (Python mirror of store.js makeHistoryId)."""
import secrets
import time


def make_audio_id():
    """Millisecond timestamp + random suffix. A bare ms timestamp collides when
    two recordings are saved in the same millisecond, silently overwriting each
    other's .ogg; the random suffix makes the filename unique."""
    return f"{int(time.time() * 1000)}-{secrets.token_hex(4)}"
