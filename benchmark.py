"""
Whisper Model Benchmark Script
Generates a test WAV file, then benchmarks load + transcribe time
for every downloaded Whisper model.
"""

import os
import sys
import time
import platform
import subprocess
import numpy as np
import soundfile as sf
import torch
import whisper

# ──────────────────────────────────────────────
# 1. System Information
# ──────────────────────────────────────────────

def get_system_info():
    """Gather CPU, RAM, GPU, and OS details."""
    info = {}

    # OS
    info["os"] = f"{platform.system()} {platform.version()}"

    # CPU (try wmic on Windows, fall back to platform.processor())
    cpu_name = platform.processor()
    try:
        result = subprocess.run(
            ["wmic", "cpu", "get", "Name"],
            capture_output=True, text=True, timeout=5
        )
        lines = [l.strip() for l in result.stdout.strip().splitlines() if l.strip()]
        if len(lines) >= 2:
            cpu_name = lines[1]
    except Exception:
        pass
    info["cpu"] = cpu_name

    # CPU cores
    info["cpu_cores_logical"] = os.cpu_count() or "unknown"

    # RAM (try wmic on Windows)
    try:
        result = subprocess.run(
            ["wmic", "OS", "get", "TotalVisibleMemorySize,FreePhysicalMemory"],
            capture_output=True, text=True, timeout=5
        )
        lines = [l.strip() for l in result.stdout.strip().splitlines() if l.strip()]
        if len(lines) >= 2:
            parts = lines[1].split()
            if len(parts) >= 2:
                free_kb = int(parts[0])
                total_kb = int(parts[1])
                info["ram_total_gb"] = f"{total_kb / (1024 * 1024):.1f}"
                info["ram_free_gb"] = f"{free_kb / (1024 * 1024):.1f}"
    except Exception:
        info["ram_total_gb"] = "unknown"
        info["ram_free_gb"] = "unknown"

    # GPU / CUDA
    info["cuda_available"] = torch.cuda.is_available()
    if info["cuda_available"]:
        info["gpu_name"] = torch.cuda.get_device_name(0)
        info["gpu_memory_gb"] = f"{torch.cuda.get_device_properties(0).total_mem / (1024**3):.1f}"
    else:
        info["gpu_name"] = "N/A (CPU-only)"
        info["gpu_memory_gb"] = "N/A"

    info["torch_version"] = torch.__version__
    info["whisper_version"] = whisper.__version__ if hasattr(whisper, "__version__") else "unknown"
    info["python_version"] = platform.python_version()

    return info


# ──────────────────────────────────────────────
# 2. Generate a 5-second Test WAV File
# ──────────────────────────────────────────────

def generate_test_audio(filepath: str, duration: float = 5.0, sample_rate: int = 16000):
    """
    Create a 5-second 16 kHz mono WAV with a sequence of tones
    (like a simple melody) so Whisper has real audio to process.
    """
    t = np.linspace(0, duration, int(sample_rate * duration), endpoint=False)

    # Build a signal: four tones, each ~1.25 seconds
    freqs = [261.63, 329.63, 392.00, 523.25]  # C4, E4, G4, C5
    segment_len = len(t) // len(freqs)
    signal = np.zeros_like(t)

    for i, freq in enumerate(freqs):
        start = i * segment_len
        end = start + segment_len if i < len(freqs) - 1 else len(t)
        # Apply a simple envelope to avoid clicks
        seg_t = t[start:end] - t[start]
        envelope = np.minimum(seg_t / 0.05, 1.0) * np.minimum((seg_t[-1] - seg_t) / 0.05, 1.0)
        signal[start:end] = 0.5 * np.sin(2 * np.pi * freq * seg_t) * envelope

    # Normalize to [-0.9, 0.9]
    signal = 0.9 * signal / (np.max(np.abs(signal)) + 1e-8)

    sf.write(filepath, signal.astype(np.float32), sample_rate, subtype="PCM_16")
    file_size_kb = os.path.getsize(filepath) / 1024
    print(f"  Generated: {filepath}")
    print(f"  Duration:  {duration}s | Sample rate: {sample_rate} Hz | Size: {file_size_kb:.1f} KB")
    return filepath


# ──────────────────────────────────────────────
# 3. Discover Downloaded Models
# ──────────────────────────────────────────────

def get_available_models():
    """Return a list of model names from the Whisper cache directory."""
    cache_dir = os.path.join(os.path.expanduser("~"), ".cache", "whisper")
    if not os.path.isdir(cache_dir):
        print(f"  Cache directory not found: {cache_dir}")
        return []

    model_files = sorted([f for f in os.listdir(cache_dir) if f.endswith(".pt")])
    # Convert filenames to model names (e.g. "tiny.en.pt" -> "tiny.en")
    model_names = [f.replace(".pt", "") for f in model_files]
    return model_names


# ──────────────────────────────────────────────
# 4. Benchmark a Single Model
# ──────────────────────────────────────────────

def benchmark_model(model_name: str, audio_path: str, device: str = "cpu"):
    """Load a model and transcribe the test audio, returning timing data."""
    result = {
        "model": model_name,
        "device": device,
        "load_time_s": None,
        "transcribe_time_s": None,
        "transcription": None,
        "error": None,
    }

    # -- Load --
    try:
        t0 = time.perf_counter()
        model = whisper.load_model(model_name, device=device)
        t1 = time.perf_counter()
        result["load_time_s"] = t1 - t0
    except Exception as e:
        result["error"] = f"Load failed: {e}"
        return result

    # -- Transcribe --
    try:
        t0 = time.perf_counter()
        output = model.transcribe(audio_path, fp16=False)
        t1 = time.perf_counter()
        result["transcribe_time_s"] = t1 - t0
        result["transcription"] = output.get("text", "").strip()
    except Exception as e:
        result["error"] = f"Transcribe failed: {e}"

    # Free memory
    del model
    if torch.cuda.is_available():
        torch.cuda.empty_cache()

    return result


# ──────────────────────────────────────────────
# 5. Print Results
# ──────────────────────────────────────────────

def print_summary(sys_info: dict, results: list):
    """Print a formatted summary table."""
    sep = "=" * 80

    print(f"\n{sep}")
    print("  WHISPER MODEL BENCHMARK RESULTS")
    print(sep)

    # System info
    print(f"\n  System Information")
    print(f"  {'-' * 40}")
    print(f"  OS:              {sys_info['os']}")
    print(f"  CPU:             {sys_info['cpu']}")
    print(f"  Logical cores:   {sys_info['cpu_cores_logical']}")
    print(f"  RAM total:       {sys_info['ram_total_gb']} GB")
    print(f"  RAM free:        {sys_info['ram_free_gb']} GB")
    print(f"  CUDA available:  {sys_info['cuda_available']}")
    print(f"  GPU:             {sys_info['gpu_name']}")
    print(f"  PyTorch:         {sys_info['torch_version']}")
    print(f"  Whisper:         {sys_info['whisper_version']}")
    print(f"  Python:          {sys_info['python_version']}")

    # Results table
    print(f"\n  Benchmark Results (device: {'cuda' if sys_info['cuda_available'] else 'cpu'})")
    print(f"  {'-' * 74}")
    header = f"  {'Model':<14} {'Load (s)':>10} {'Transcribe (s)':>16} {'Total (s)':>12} {'Transcription'}"
    print(header)
    print(f"  {'-' * 74}")

    for r in results:
        if r["error"]:
            print(f"  {r['model']:<14} {'ERROR':>10}   {r['error']}")
            continue

        load_t = r["load_time_s"]
        trans_t = r["transcribe_time_s"]
        total_t = (load_t or 0) + (trans_t or 0)
        transcript = r["transcription"] or ""
        # Truncate long transcriptions for the table
        if len(transcript) > 30:
            transcript = transcript[:27] + "..."
        elif not transcript:
            transcript = "(empty)"

        print(
            f"  {r['model']:<14} {load_t:>10.2f} {trans_t:>16.2f} {total_t:>12.2f}   {transcript}"
        )

    print(f"  {'-' * 74}")

    # Ranking
    valid = [r for r in results if r["error"] is None and r["transcribe_time_s"] is not None]
    if valid:
        fastest = min(valid, key=lambda r: r["transcribe_time_s"])
        slowest = max(valid, key=lambda r: r["transcribe_time_s"])
        print(f"\n  Fastest transcription: {fastest['model']} ({fastest['transcribe_time_s']:.2f}s)")
        print(f"  Slowest transcription: {slowest['model']} ({slowest['transcribe_time_s']:.2f}s)")
        if fastest["transcribe_time_s"] > 0:
            ratio = slowest["transcribe_time_s"] / fastest["transcribe_time_s"]
            print(f"  Slowest/Fastest ratio: {ratio:.1f}x")

    print(f"\n{sep}\n")


# ──────────────────────────────────────────────
# Main
# ──────────────────────────────────────────────

def main():
    print("\n" + "=" * 80)
    print("  WHISPER MODEL BENCHMARK")
    print("=" * 80)

    # Step 1: System info
    print("\n[1/4] Gathering system information...")
    sys_info = get_system_info()
    print(f"  CPU:  {sys_info['cpu']}")
    print(f"  CUDA: {sys_info['cuda_available']}")

    # Step 2: Generate test audio
    print("\n[2/4] Generating test audio...")
    script_dir = os.path.dirname(os.path.abspath(__file__))
    audio_path = os.path.join(script_dir, "benchmark_test_audio.wav")
    generate_test_audio(audio_path)

    # Step 3: Discover models
    print("\n[3/4] Discovering downloaded models...")
    models = get_available_models()
    if not models:
        print("  No models found! Download at least one with: whisper.load_model('tiny')")
        sys.exit(1)
    print(f"  Found {len(models)} model(s): {', '.join(models)}")

    # Step 4: Benchmark
    device = "cuda" if torch.cuda.is_available() else "cpu"
    print(f"\n[4/4] Running benchmarks on device: {device}")
    print(f"  This may take a while for larger models...\n")

    results = []
    for i, model_name in enumerate(models, 1):
        print(f"  [{i}/{len(models)}] Benchmarking '{model_name}'...")
        r = benchmark_model(model_name, audio_path, device=device)
        if r["error"]:
            print(f"         ERROR: {r['error']}")
        else:
            print(f"         Load: {r['load_time_s']:.2f}s | Transcribe: {r['transcribe_time_s']:.2f}s")
        results.append(r)

    # Step 5: Summary
    print_summary(sys_info, results)

    # Cleanup test audio
    if os.path.exists(audio_path):
        os.remove(audio_path)
        print("  Cleaned up test audio file.\n")


if __name__ == "__main__":
    main()
