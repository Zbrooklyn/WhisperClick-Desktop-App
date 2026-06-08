"""Security: API keys must travel in headers, never the URL query string.

A key in the URL leaks into proxy/access logs and any traceback that prints the
request URL. These tests pin the "no key in URL" guarantee for every key-bearing
request the engine builds.
"""
from backend.api_requests import build_gemini_request, build_verify_request

SECRET = "sk-SUPERSECRET-DO-NOT-LEAK-123"


def test_gemini_request_key_in_header_not_url():
    req = build_gemini_request(
        "https://generativelanguage.googleapis.com/v1beta",
        "gemini-2.0-flash", SECRET, b"{}",
    )
    assert SECRET not in req.full_url
    assert "key=" not in req.full_url
    # urllib capitalizes header names
    assert req.get_header("X-goog-api-key") == SECRET


def test_verify_request_openai_key_in_auth_header_not_url():
    req = build_verify_request("openai", "https://api.openai.com/v1", SECRET)
    assert SECRET not in req.full_url
    assert req.get_header("Authorization") == f"Bearer {SECRET}"


def test_verify_request_gemini_key_in_header_not_url():
    req = build_verify_request(
        "gemini", "https://generativelanguage.googleapis.com/v1beta", SECRET)
    assert SECRET not in req.full_url
    assert "key=" not in req.full_url
    assert req.get_header("X-goog-api-key") == SECRET


# --- Redaction: a key echoed back in an API error body must never surface ---
# Some upstream error responses echo the offending key. The engine truncates the
# body and replaces the key with *** before putting it in a raised/logged error.
# These pin that scrubbing for both Gemini network paths.

import io
from urllib.error import HTTPError

import backend.transcription as tx
from backend.transcription import TranscriptionService


def _raise_http_error_with_leaky_body(monkeypatch):
    """Make urlopen raise a 400 whose body contains the secret key verbatim."""
    leaky_body = ('{"error":{"code":400,"message":"API key not valid: '
                  + SECRET + '"}}').encode("utf-8")

    def fake_urlopen(req, timeout=None):
        raise HTTPError(
            "https://generativelanguage.googleapis.com/v1beta",
            400, "Bad Request", {}, io.BytesIO(leaky_body),
        )

    monkeypatch.setattr(tx.urllib_request, "urlopen", fake_urlopen)


def test_gemini_translate_error_body_redacts_api_key(monkeypatch):
    svc = TranscriptionService()
    svc._api_key = SECRET
    _raise_http_error_with_leaky_body(monkeypatch)

    try:
        svc._translate_gemini("hello world", "es")
        assert False, "expected ValueError"
    except ValueError as exc:
        msg = str(exc)
        assert SECRET not in msg, f"API key leaked into error: {msg!r}"
        assert "***" in msg


def test_gemini_transcribe_error_body_redacts_api_key(monkeypatch):
    svc = TranscriptionService()
    svc._api_key = SECRET
    # Skip real audio compression — redaction is independent of the audio path.
    svc._compress_audio = lambda wav_bytes: io.BytesIO(b"fake-audio-bytes")
    _raise_http_error_with_leaky_body(monkeypatch)

    try:
        svc._transcribe_gemini(b"fake-wav", SECRET)
        assert False, "expected ValueError"
    except ValueError as exc:
        msg = str(exc)
        assert SECRET not in msg, f"API key leaked into error: {msg!r}"
        assert "***" in msg
