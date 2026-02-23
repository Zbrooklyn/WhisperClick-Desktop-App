#!/usr/bin/env python
"""Headed UI smoke test for WhisperClick desktop app.

What it validates:
- App process can be launched in a normal desktop session.
- Main window titled "WhisperClick" becomes visible within timeout.
- Optional screenshot capture of the detected window.

Notes:
- This is a headed test and requires an unlocked interactive desktop session.
- It is intentionally lightweight and non-destructive.
"""

from __future__ import annotations

import argparse
import json
import subprocess
import time
from datetime import datetime
from pathlib import Path

from pywinauto import Desktop

APP_TITLE_REGEX = r"WhisperClick"


def wait_for_window(timeout_seconds: float):
    """Wait for a visible WhisperClick window and return (window, rect) or (None, None)."""
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


def capture_window_screenshot(rect, out_path: Path) -> str:
    """Capture screenshot of window rectangle and return path."""
    from PIL import ImageGrab

    out_path.parent.mkdir(parents=True, exist_ok=True)
    left = max(0, rect.left)
    top = max(0, rect.top)
    right = max(left + 1, rect.right)
    bottom = max(top + 1, rect.bottom)
    image = ImageGrab.grab(bbox=(left, top, right, bottom))
    image.save(out_path)
    return str(out_path)


def build_default_screenshot_path(project_dir: Path) -> Path:
    ts = datetime.now().strftime("%Y%m%d-%H%M%S")
    return project_dir / "tmp" / f"ui-smoke-{ts}.png"


def main() -> int:
    parser = argparse.ArgumentParser(description="WhisperClick headed UI smoke test")
    parser.add_argument(
        "--timeout",
        type=float,
        default=20.0,
        help="Seconds to wait for window visibility (default: 20)",
    )
    parser.add_argument(
        "--screenshot",
        action="store_true",
        help="Capture a screenshot of the detected app window",
    )
    parser.add_argument(
        "--screenshot-path",
        default="",
        help="Optional screenshot file path (used only with --screenshot)",
    )
    args = parser.parse_args()

    project_dir = Path(__file__).resolve().parents[1]
    # Check for local venv first, then fall back to sibling V2 venv
    python_exe = project_dir / "venv" / "Scripts" / "python.exe"
    if not python_exe.exists():
        v2_venv = project_dir.parent / "whisper-stt-v2" / "venv" / "Scripts" / "python.exe"
        if v2_venv.exists():
            python_exe = v2_venv
    main_py = project_dir / "src" / "main.py"

    result = {
        "ok": False,
        "project_dir": str(project_dir),
        "timeout_seconds": args.timeout,
        "launched_pid": None,
        "window_detected": False,
        "window_rect": None,
        "window_text": "",
        "screenshot_path": "",
        "error": "",
    }

    if not python_exe.exists():
        result["error"] = f"Missing python executable: {python_exe}"
        print(json.dumps(result, indent=2))
        return 1
    if not main_py.exists():
        result["error"] = f"Missing app entrypoint: {main_py}"
        print(json.dumps(result, indent=2))
        return 1

    proc = None
    try:
        proc = subprocess.Popen(
            [str(python_exe), str(main_py)],
            cwd=str(project_dir),
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        result["launched_pid"] = proc.pid

        window, rect = wait_for_window(args.timeout)
        if window is None:
            code = proc.poll()
            if code is not None:
                result["error"] = f"App process exited before UI was detected (exit={code})."
            else:
                result["error"] = "Timed out waiting for WhisperClick window."
            print(json.dumps(result, indent=2))
            return 1

        result["window_detected"] = True
        result["window_rect"] = {
            "left": rect.left,
            "top": rect.top,
            "right": rect.right,
            "bottom": rect.bottom,
            "width": rect.width(),
            "height": rect.height(),
        }
        try:
            result["window_text"] = window.window_text()
        except Exception:
            result["window_text"] = "WhisperClick"

        if args.screenshot:
            out_path = (
                Path(args.screenshot_path) if args.screenshot_path else build_default_screenshot_path(project_dir)
            )
            result["screenshot_path"] = capture_window_screenshot(rect, out_path)

        result["ok"] = True
        print(json.dumps(result, indent=2))
        return 0
    except Exception as exc:
        result["error"] = str(exc)
        print(json.dumps(result, indent=2))
        return 1
    finally:
        if proc is not None and proc.poll() is None:
            proc.terminate()
            try:
                proc.wait(timeout=4)
            except subprocess.TimeoutExpired:
                proc.kill()


if __name__ == "__main__":
    raise SystemExit(main())
