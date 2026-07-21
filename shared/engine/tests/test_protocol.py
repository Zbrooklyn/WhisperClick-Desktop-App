"""Characterization tests for the engine command protocol.

These pin the observable request->response behavior of the headless-testable
commands so the handle_command decomposition can't silently change it. They run
against one shared engine subprocess for speed.
"""
import itertools
import json
import os
import subprocess
import sys
import threading
import time

import pytest

ENGINE = os.path.join(os.path.dirname(os.path.dirname(__file__)), "engine.py")


class EngineProc:
    def __init__(self):
        self.p = subprocess.Popen(
            [sys.executable, "-u", ENGINE],
            stdin=subprocess.PIPE, stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL, cwd=os.path.dirname(ENGINE),
            text=True, bufsize=1,
        )
        self.recv = []
        self._ids = itertools.count(1)
        ready = threading.Event()

        def reader():
            for line in self.p.stdout:
                line = line.strip()
                if not line:
                    continue
                try:
                    m = json.loads(line)
                except Exception:
                    continue
                self.recv.append(m)
                if m.get("event") == "ready":
                    ready.set()
        threading.Thread(target=reader, daemon=True).start()
        assert ready.wait(15), "engine did not become ready"

    def call(self, command, timeout=10, **payload):
        mid = next(self._ids)
        self.p.stdin.write(json.dumps({"id": mid, "command": command, **payload}) + "\n")
        self.p.stdin.flush()
        deadline = time.time() + timeout
        while time.time() < deadline:
            for m in list(self.recv):
                if m.get("id") == mid:
                    return m
            time.sleep(0.02)
        raise AssertionError(f"no response to {command!r}")

    def close(self):
        try:
            self.p.stdin.write('{"id":0,"command":"quit"}\n')
            self.p.stdin.flush()
        except Exception:
            pass
        time.sleep(0.2)
        self.p.kill()


@pytest.fixture(scope="module")
def engine():
    e = EngineProc()
    yield e
    e.close()


def test_ping(engine):
    r = engine.call("ping")
    assert r["status"] == "ok" and r["pong"] is True
    assert r["version"]


def test_get_languages(engine):
    r = engine.call("get_languages")
    assert r["status"] == "ok"
    assert isinstance(r["languages"], list) and r["languages"]


def test_list_models(engine):
    r = engine.call("list_models")
    assert r["status"] == "ok"
    assert isinstance(r["models"], list) and r["models"]
    for m in r["models"]:
        assert {"name", "size_mb", "description", "downloaded"} <= set(m)


def test_list_mics(engine):
    r = engine.call("list_mics")
    assert r["status"] == "ok"
    assert isinstance(r["mics"], list)


@pytest.mark.parametrize("command,payload", [
    ("set_mode", {"mode": "api"}),
    ("set_language", {"language": "en"}),
    ("set_model", {"model": "base"}),
    ("set_sound_enabled", {"enabled": True}),
    ("set_output_mode", {"output_mode": "transcribe"}),
    ("set_target_language", {"target_language": "es"}),
    ("set_source_language", {"source_language": "auto"}),
    ("set_api_credentials", {"provider": "openai", "api_key": "x"}),
    ("configure", {"mode": "api", "language": "en", "sound_enabled": True}),
])
def test_config_commands_ok(engine, command, payload):
    r = engine.call(command, **payload)
    assert r["status"] == "ok"


def test_unknown_command_errors(engine):
    r = engine.call("does_not_exist")
    assert r["status"] == "error"
    assert "Unknown command" in r["error"]


def test_verify_key_invalid_provider(engine):
    r = engine.call("verify_key", provider="bogus", api_key="x")
    assert r["success"] is False and r["valid"] is False
    assert "Invalid provider" in r["error"]


def test_verify_key_missing_key(engine):
    r = engine.call("verify_key", provider="openai", api_key="")
    assert r["success"] is False and r["valid"] is False
    assert "required" in r["error"].lower()
