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
