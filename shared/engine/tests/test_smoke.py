"""Smoke test — proves the pytest harness runs and the backend package imports."""


def test_harness_runs():
    assert True


def test_backend_imports():
    import backend.audio_recorder  # noqa: F401
