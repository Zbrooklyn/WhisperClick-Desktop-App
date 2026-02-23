#!/usr/bin/env python
"""Full smoke test harness for WhisperClick.

This script runs:
1) Automated checks (backend API surface + headed app launch)
2) Outputs a manual checklist for user-driven recording/API validation

It avoids destructive changes and keeps side effects minimal.
"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
import time
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any

from pywinauto import Desktop

APP_TITLE_REGEX = r"WhisperClick"
REQUIRED_SETTINGS_KEYS = {
    "mode",
    "model",
    "language",
    "theme",
    "auto_copy",
    "start_with_windows",
    "hotkey",
    "close_behavior",
    "sound_enabled",
    "always_on_top",
    "show_pill_widget",
}
EXPECTED_MODELS = {"tiny", "base", "small", "medium", "large", "turbo"}


@dataclass
class StepResult:
    name: str
    ok: bool
    details: str = ""
    skipped: bool = False


def wait_for_window(timeout_seconds: float):
    deadline = time.time() + timeout_seconds
    while time.time() < deadline:
        try:
            windows = Desktop(backend="uia").windows(title_re=APP_TITLE_REGEX)
        except Exception:
            windows = []

        for window in windows:
            try:
                if not window.is_visible():
                    continue
                rect = window.rectangle()
                if rect.width() > 0 and rect.height() > 0:
                    return window, rect
            except Exception:
                continue
        time.sleep(0.25)
    return None, None


def run_full_smoke(timeout: float) -> dict[str, Any]:
    project_dir = Path(__file__).resolve().parents[1]
    # Check for local venv first, then fall back to sibling V2 venv
    python_exe = project_dir / "venv" / "Scripts" / "python.exe"
    if not python_exe.exists():
        v2_venv = project_dir.parent / "whisper-stt-v2" / "venv" / "Scripts" / "python.exe"
        if v2_venv.exists():
            python_exe = v2_venv
    main_py = project_dir / "src" / "main.py"

    report: dict[str, Any] = {
        "ok": False,
        "project_dir": str(project_dir),
        "automated_steps": [],
        "manual_checklist": [
            "In app, confirm Local mode selected and record a short phrase; verify transcript is created in History.",
            "Open Settings -> API Providers, paste API key (OpenAI or Gemini), then record in API mode; verify transcript/translation in History.",
            "Open tray menu: Show, Record, Settings, Quit all function correctly.",
            "Enable Pill Widget in Settings, minimize/close to tray, verify pill appears and context actions work (Show/Settings/Paste/Hide).",
            "In Settings -> Local Model Manager, verify Download/Delete/Refresh controls behave correctly for at least one model.",
            "Change hotkey in Settings and restart app; verify new hotkey works globally.",
            "Toggle theme and restart app; verify theme preference persists.",
        ],
        "notes": "Manual checklist requires user interaction, microphone, and valid API key.",
    }

    if not python_exe.exists():
        report["automated_steps"].append(asdict(StepResult("venv_python_exists", False, f"Missing {python_exe}")))
        return report
    if not main_py.exists():
        report["automated_steps"].append(asdict(StepResult("main_py_exists", False, f"Missing {main_py}")))
        return report

    sys.path.insert(0, str(project_dir))

    # Backend API checks
    try:
        from src.backend.api import Api
    except Exception as exc:
        report["automated_steps"].append(asdict(StepResult("import_backend_api", False, str(exc))))
        return report

    try:
        api = Api()
        report["automated_steps"].append(asdict(StepResult("backend_api_init", True, "Api() instantiated")))
    except Exception as exc:
        report["automated_steps"].append(asdict(StepResult("backend_api_init", False, str(exc))))
        return report

    try:
        settings = api.get_settings()
        missing = sorted(REQUIRED_SETTINGS_KEYS.difference(settings.keys()))
        if missing:
            report["automated_steps"].append(
                asdict(StepResult("get_settings_required_keys", False, f"Missing keys: {missing}"))
            )
        else:
            report["automated_steps"].append(
                asdict(StepResult("get_settings_required_keys", True, "Required keys present"))
            )
    except Exception as exc:
        report["automated_steps"].append(asdict(StepResult("get_settings_required_keys", False, str(exc))))

    try:
        hotkey = api.get_settings().get("hotkey", "Ctrl+Shift+R")
        save_resp = api.save_settings({"hotkey": hotkey})
        if not save_resp.get("success"):
            report["automated_steps"].append(
                asdict(StepResult("save_settings_hotkey_roundtrip", False, save_resp.get("error", "save failed")))
            )
        else:
            report["automated_steps"].append(
                asdict(StepResult("save_settings_hotkey_roundtrip", True, f"hotkey={hotkey}"))
            )
    except Exception as exc:
        report["automated_steps"].append(asdict(StepResult("save_settings_hotkey_roundtrip", False, str(exc))))

    try:
        models = api.get_models()
        names = {m.get("name") for m in models}
        missing_models = sorted(EXPECTED_MODELS.difference(names))
        if missing_models:
            report["automated_steps"].append(
                asdict(StepResult("get_models_expected_set", False, f"Missing models: {missing_models}"))
            )
        else:
            downloaded = [m.get("name") for m in models if m.get("downloaded")]
            report["automated_steps"].append(
                asdict(StepResult("get_models_expected_set", True, f"downloaded={downloaded}"))
            )
    except Exception as exc:
        report["automated_steps"].append(asdict(StepResult("get_models_expected_set", False, str(exc))))

    try:
        mics = api.get_microphones()
        if not isinstance(mics, list):
            report["automated_steps"].append(
                asdict(StepResult("get_microphones_list", False, f"Expected list, got {type(mics).__name__}"))
            )
        else:
            report["automated_steps"].append(asdict(StepResult("get_microphones_list", True, f"count={len(mics)}")))
            if mics:
                mic_id = mics[0].get("id")
                set_resp = api.set_microphone(mic_id)
                report["automated_steps"].append(
                    asdict(
                        StepResult(
                            "set_microphone_first_device",
                            bool(set_resp.get("success")),
                            set_resp.get("error", f"id={mic_id}"),
                        )
                    )
                )
            else:
                report["automated_steps"].append(
                    asdict(StepResult("set_microphone_first_device", True, "No microphones found", skipped=True))
                )
    except Exception as exc:
        report["automated_steps"].append(asdict(StepResult("get_microphones_list", False, str(exc))))

    try:
        history = api.get_history()
        if not isinstance(history, list):
            report["automated_steps"].append(
                asdict(StepResult("get_history_list", False, f"Expected list, got {type(history).__name__}"))
            )
        else:
            report["automated_steps"].append(asdict(StepResult("get_history_list", True, f"count={len(history)}")))
    except Exception as exc:
        report["automated_steps"].append(asdict(StepResult("get_history_list", False, str(exc))))

    try:
        clip_resp = api.copy_to_clipboard("whisperclick smoke test")
        report["automated_steps"].append(
            asdict(
                StepResult(
                    "copy_to_clipboard",
                    bool(clip_resp.get("success")),
                    clip_resp.get("error", "ok"),
                )
            )
        )
    except Exception as exc:
        report["automated_steps"].append(asdict(StepResult("copy_to_clipboard", False, str(exc))))

    # Headed UI launch check
    proc = None
    try:
        proc = subprocess.Popen(
            [str(python_exe), str(main_py)],
            cwd=str(project_dir),
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        window, rect = wait_for_window(timeout)
        if window is None:
            code = proc.poll()
            if code is None:
                details = "Timed out waiting for WhisperClick window."
            else:
                details = f"Process exited early (exit={code})."
            report["automated_steps"].append(asdict(StepResult("headed_window_launch", False, details)))
        else:
            report["automated_steps"].append(
                asdict(
                    StepResult(
                        "headed_window_launch",
                        True,
                        f"rect={rect.left},{rect.top},{rect.right},{rect.bottom}",
                    )
                )
            )
    except Exception as exc:
        report["automated_steps"].append(asdict(StepResult("headed_window_launch", False, str(exc))))
    finally:
        if proc is not None and proc.poll() is None:
            proc.terminate()
            try:
                proc.wait(timeout=4)
            except subprocess.TimeoutExpired:
                proc.kill()

    failed = [s for s in report["automated_steps"] if not s["ok"] and not s.get("skipped")]
    report["ok"] = len(failed) == 0
    report["automated_passed"] = len([s for s in report["automated_steps"] if s["ok"]])
    report["automated_failed"] = len(failed)
    return report


def main() -> int:
    parser = argparse.ArgumentParser(description="WhisperClick full smoke test harness")
    parser.add_argument("--timeout", type=float, default=25.0, help="Window wait timeout in seconds")
    args = parser.parse_args()

    report = run_full_smoke(args.timeout)
    print(json.dumps(report, indent=2))
    return 0 if report.get("ok") else 1


if __name__ == "__main__":
    raise SystemExit(main())
