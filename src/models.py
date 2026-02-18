import os
import urllib.request

CACHE_DIR = os.path.join(os.path.expanduser("~"), ".cache", "whisper")

MODEL_INFO = {
    "tiny": {"size_mb": 75, "description": "Fastest, least accurate", "file": "tiny.pt"},
    "base": {"size_mb": 142, "description": "Good balance of speed and accuracy", "file": "base.pt"},
    "small": {"size_mb": 466, "description": "More accurate, slower", "file": "small.pt"},
    "medium": {"size_mb": 1500, "description": "High accuracy, requires ~5GB RAM", "file": "medium.pt"},
    "large": {"size_mb": 3000, "description": "Best accuracy, requires ~10GB RAM", "file": "large-v3.pt"},
    "turbo": {"size_mb": 1500, "description": "Fast + accurate (large-v3-turbo)", "file": "large-v3-turbo.pt"},
}

# URLs from openai-whisper package
MODEL_URLS = {
    "tiny": "https://openaipublic.azureedge.net/main/whisper/models/65147644a518d12f04e32d6f3b26facc3f8dd46e5390956a9424a650c0ce22b9/tiny.pt",
    "base": "https://openaipublic.azureedge.net/main/whisper/models/ed3a0b6b1c0edf879ad9b11b1af5a0e6ab5db9205f891f668f8b0e6c6326e34e/base.pt",
    "small": "https://openaipublic.azureedge.net/main/whisper/models/9ecf779972d90ba49c06d968637d720dd632c55bbf19d441fb42bf17a411e794/small.pt",
    "medium": "https://openaipublic.azureedge.net/main/whisper/models/345ae4da62f9b3d59415adc60127b97c714f32e89e936602e85993674d08dcb1/medium.pt",
    "large": "https://openaipublic.azureedge.net/main/whisper/models/e5b1a55b89c1367dacf97e3e19bfd829a01529dbfdeefa8caeb59b3f1b81dadb/large-v3.pt",
    "turbo": "https://openaipublic.azureedge.net/main/whisper/models/aff26ae408abcba5fbf8813c21e62b0941638c5f6eebfb145be0c9839262a19a/large-v3-turbo.pt",
}


def is_model_downloaded(model_name: str) -> bool:
    info = MODEL_INFO.get(model_name)
    if not info:
        return False
    path = os.path.join(CACHE_DIR, info["file"])
    return os.path.exists(path)


def get_downloaded_models() -> list[str]:
    return [name for name in MODEL_INFO if is_model_downloaded(name)]


def download_model(model_name: str, progress_callback=None):
    """Download a Whisper model with progress reporting.

    progress_callback(bytes_downloaded, total_bytes) is called periodically.
    """
    url = MODEL_URLS.get(model_name)
    if not url:
        raise ValueError(f"Unknown model: {model_name}")

    os.makedirs(CACHE_DIR, exist_ok=True)
    dest = os.path.join(CACHE_DIR, MODEL_INFO[model_name]["file"])

    req = urllib.request.urlopen(url)
    total = int(req.headers.get("Content-Length", 0))
    downloaded = 0
    chunk_size = 1024 * 256  # 256KB chunks

    with open(dest, "wb") as f:
        while True:
            chunk = req.read(chunk_size)
            if not chunk:
                break
            f.write(chunk)
            downloaded += len(chunk)
            if progress_callback:
                progress_callback(downloaded, total)
