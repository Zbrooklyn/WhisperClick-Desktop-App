"""HTTP request builders that keep API keys in HEADERS, never the URL.

Putting the key in the URL query string risks leaking it into proxy/access logs
and into any traceback or log line that prints the request URL. These builders
are the single place key-bearing requests are constructed, so the "key never in
URL" guarantee is testable in one spot.
"""
from urllib import request as urllib_request


def redact_key(text, key, limit=None):
    """Scrub an API key out of text that may be logged or shown to the user.

    Some upstream error bodies echo the offending key verbatim, so any error
    detail that travels into a log line or a raised message must be scrubbed.
    Optionally truncate to `limit` chars first (error bodies can be large). A
    falsy key is a no-op, so an empty/unset key never becomes a literal "***".
    """
    if limit is not None:
        text = text[:limit]
    if key:
        text = text.replace(key, "***")
    return text


def build_gemini_request(base_url, model, api_key, body_bytes):
    """Gemini generateContent POST — key in the x-goog-api-key header."""
    url = f"{base_url}/models/{model}:generateContent"
    headers = {"Content-Type": "application/json", "x-goog-api-key": api_key}
    return urllib_request.Request(url, data=body_bytes, headers=headers, method="POST")


def build_verify_request(provider, base_url, key):
    """API-key verification GET — key in Authorization (OpenAI) or
    x-goog-api-key (Gemini) header."""
    url = f"{base_url}/models"
    if provider == "openai":
        headers = {"Authorization": f"Bearer {key}"}
    else:
        headers = {"x-goog-api-key": key}
    return urllib_request.Request(url, headers=headers, method="GET")
