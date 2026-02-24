import fnmatch
import os
import shutil

from src.backend.config import MODELS_DIR

# Models are stored per-environment under CONFIG_DIR/models/
# (dev and prod are fully isolated)
HF_CACHE_DIR = MODELS_DIR

# Map model names to their HuggingFace repo IDs (used by faster-whisper)
MODEL_INFO = {
    "tiny": {
        "size_mb": 75,
        "description": "Fastest — no punctuation, minor errors",
        "repo": "Systran/faster-whisper-tiny",
    },
    "base": {
        "size_mb": 142,
        "description": "Best for CPU — fast + accurate (recommended)",
        "repo": "Systran/faster-whisper-base",
    },
    "small": {
        "size_mb": 466,
        "description": "Best punctuation — 2x slower than base",
        "repo": "Systran/faster-whisper-small",
    },
    "medium": {
        "size_mb": 1500,
        "description": "High accuracy — slow on CPU, needs ~5GB RAM",
        "repo": "Systran/faster-whisper-medium",
    },
    "large": {
        "size_mb": 3000,
        "description": "Best accuracy — very slow on CPU, needs GPU",
        "repo": "Systran/faster-whisper-large-v3",
    },
    "turbo": {
        "size_mb": 1500,
        "description": "Fast on GPU only — slow on CPU, skip if no GPU",
        "repo": "Systran/faster-whisper-large-v3-turbo",
    },
}


def _get_model_cache_dir(model_name):
    """Get the HuggingFace cache directory for a model."""
    info = MODEL_INFO.get(model_name)
    if not info:
        return None
    # HF stores repos as models--{org}--{name}
    repo = info["repo"].replace("/", "--")
    return os.path.join(HF_CACHE_DIR, f"models--{repo}")


def is_model_downloaded(model_name):
    cache_dir = _get_model_cache_dir(model_name)
    if not cache_dir:
        return False
    # Check if the snapshot directory exists and has files
    snapshot_dir = os.path.join(cache_dir, "snapshots")
    if not os.path.isdir(snapshot_dir):
        return False
    # Check if any snapshot has a model.bin file
    for snap in os.listdir(snapshot_dir):
        snap_path = os.path.join(snapshot_dir, snap)
        if os.path.isdir(snap_path) and os.path.exists(os.path.join(snap_path, "model.bin")):
            return True
    return False


def get_downloaded_models():
    return [name for name in MODEL_INFO if is_model_downloaded(name)]


def delete_model(model_name):
    cache_dir = _get_model_cache_dir(model_name)
    if cache_dir and os.path.isdir(cache_dir):
        shutil.rmtree(cache_dir)


def download_model(model_name, progress_callback=None):
    """Download a faster-whisper model via huggingface_hub."""
    info = MODEL_INFO.get(model_name)
    if not info:
        raise ValueError(f"Unknown model: {model_name}")

    from huggingface_hub import hf_hub_download, list_repo_files

    allow_patterns = ["*.bin", "*.json", "*.txt", "tokenizer.*", "vocabulary.*"]

    def _allowed(path: str) -> bool:
        name = os.path.basename(path)
        return any(fnmatch.fnmatch(path, pattern) or fnmatch.fnmatch(name, pattern) for pattern in allow_patterns)

    repo_id = info["repo"]
    files = [f for f in list_repo_files(repo_id=repo_id, repo_type="model") if _allowed(f)]
    if not files:
        raise RuntimeError(f"No downloadable model files found for {repo_id}")

    total = len(files)
    if progress_callback:
        progress_callback(0, total)

    os.makedirs(HF_CACHE_DIR, exist_ok=True)
    for idx, filename in enumerate(files, start=1):
        hf_hub_download(repo_id=repo_id, filename=filename, repo_type="model", cache_dir=HF_CACHE_DIR)
        if progress_callback:
            progress_callback(idx, total)
