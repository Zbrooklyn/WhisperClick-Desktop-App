"""audio_id collision: ids generated in the same millisecond must be unique."""
from backend.ids import make_audio_id


def test_audio_ids_unique_even_in_tight_loop():
    ids = [make_audio_id() for _ in range(2000)]
    assert len(set(ids)) == len(ids), "audio ids collided (same-ms overwrite risk)"


def test_audio_id_shape():
    aid = make_audio_id()
    ts, _, suffix = aid.partition("-")
    assert ts.isdigit()
    assert len(suffix) == 8  # token_hex(4) -> 8 hex chars
