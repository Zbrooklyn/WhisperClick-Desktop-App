#!/usr/bin/env python3
"""
Mock Python sidecar engine for WhisperClick Electron E2E tests.

Implements the full JSON line protocol:
- Sends a 'ready' event on startup
- Handles all commands the real engine supports
- Returns deterministic responses for testing
"""

import json
import sys
import time
import threading


def send(msg):
    """Write a JSON line to stdout."""
    sys.stdout.write(json.dumps(msg) + "\n")
    sys.stdout.flush()


def send_event(event, data=None):
    """Send an event-style message (no id)."""
    msg = {"event": event}
    if data is not None:
        msg["data"] = data
    send(msg)


def handle_command(msg):
    """Process a command and return a response dict."""
    cmd = msg.get("command", "")
    msg_id = msg.get("id", 0)

    if cmd == "quit":
        send({"id": msg_id, "result": "ok"})
        sys.exit(0)

    elif cmd == "ping":
        return {"id": msg_id, "result": "pong"}

    elif cmd == "configure":
        return {"id": msg_id, "result": "ok"}

    elif cmd == "list_mics":
        return {
            "id": msg_id,
            "devices": [
                {"id": 0, "name": "Default Microphone", "is_default": True},
                {"id": 1, "name": "USB Mic", "is_default": False},
            ],
        }

    elif cmd == "set_mic":
        device_id = msg.get("device_id", 0)
        return {"id": msg_id, "result": "ok", "device_id": device_id}

    elif cmd == "start_rec":
        # Send fake level events in a background thread
        def emit_levels():
            for i in range(5):
                time.sleep(0.1)
                send_event("level", {"level": 0.3 + (i * 0.1)})

        threading.Thread(target=emit_levels, daemon=True).start()
        return {"id": msg_id, "result": "ok"}

    elif cmd == "stop_rec":
        # Send a transcription event after a short delay
        def emit_transcription():
            time.sleep(0.3)
            send_event(
                "transcription",
                {
                    "text": "Hello, this is a test transcription.",
                    "duration": 2.5,
                    "transcription_time": 0.8,
                    "provider": "openai",
                    "model": "whisper-1",
                    "language": "en",
                },
            )

        threading.Thread(target=emit_transcription, daemon=True).start()
        return {"id": msg_id, "result": "ok"}

    elif cmd == "cancel":
        send_event("cancelled")
        return {"id": msg_id, "result": "ok"}

    elif cmd == "list_models":
        return {
            "id": msg_id,
            "models": [
                {"name": "tiny", "size": "75 MB", "downloaded": True},
                {"name": "base", "size": "142 MB", "downloaded": True},
                {"name": "small", "size": "466 MB", "downloaded": False},
            ],
        }

    elif cmd == "download_model":
        model_name = msg.get("model_name", "base")

        def emit_progress():
            for pct in [0, 25, 50, 75, 100]:
                time.sleep(0.05)
                send_event(
                    "model_download_progress",
                    {
                        "model": model_name,
                        "progress": pct,
                        "status": "downloading" if pct < 100 else "complete",
                    },
                )

        threading.Thread(target=emit_progress, daemon=True).start()
        return {"id": msg_id, "result": "ok"}

    elif cmd == "delete_model":
        return {"id": msg_id, "result": "ok"}

    elif cmd == "verify_key":
        provider = msg.get("provider", "openai")
        api_key = msg.get("api_key", "")
        if provider == "openai" and api_key.startswith("sk-"):
            return {"id": msg_id, "valid": True, "success": True}
        elif provider == "gemini" and api_key.startswith("AIza"):
            return {"id": msg_id, "valid": True, "success": True}
        else:
            return {
                "id": msg_id,
                "valid": False,
                "success": True,
                "error": f"Invalid key format for {provider}",
            }

    elif cmd == "get_languages":
        return {
            "id": msg_id,
            "languages": [
                {"code": "en", "name": "English"},
                {"code": "es", "name": "Spanish"},
                {"code": "fr", "name": "French"},
            ],
        }

    elif cmd == "translate":
        text = msg.get("text", "")
        target = msg.get("target_language", "en")
        return {
            "id": msg_id,
            "result": "ok",
            "text": f"[Translated to {target}]: {text}",
        }

    else:
        return {"id": msg_id, "error": f"Unknown command: {cmd}"}


def main():
    # Signal ready
    send_event("ready", {"version": "mock-1.0"})

    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            msg = json.loads(line)
        except json.JSONDecodeError:
            continue

        response = handle_command(msg)
        if response:
            send(response)


if __name__ == "__main__":
    main()
