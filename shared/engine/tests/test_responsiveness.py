"""Responsiveness / head-of-line-blocking tests for the engine dispatch loop.

Proves a slow command (here: verify_key against an unreachable host, ~10s to
time out) does not block unrelated lightweight commands. Spawns the real engine
and speaks its stdin/stdout JSON protocol.
"""
import json
import os
import subprocess
import sys
import threading
import time

import pytest

ENGINE = os.path.join(os.path.dirname(os.path.dirname(__file__)), "engine.py")
BLACKHOLE = "https://10.255.255.1"  # non-routable -> connect hangs to timeout


def _spawn():
    p = subprocess.Popen(
        [sys.executable, "-u", ENGINE],
        stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
        cwd=os.path.dirname(ENGINE), text=True, bufsize=1,
    )
    recv = []
    ready = threading.Event()

    def reader():
        for line in p.stdout:
            line = line.strip()
            if not line:
                continue
            try:
                m = json.loads(line)
            except Exception:
                continue
            recv.append((time.time(), m))
            if m.get("event") == "ready":
                ready.set()

    threading.Thread(target=reader, daemon=True).start()
    assert ready.wait(15), "engine did not become ready"
    return p, recv


def _send(p, **payload):
    p.stdin.write(json.dumps(payload) + "\n")
    p.stdin.flush()


def _wait_for(recv, msg_id, timeout):
    deadline = time.time() + timeout
    while time.time() < deadline:
        for t, m in recv:
            if m.get("id") == msg_id:
                return t, m
        time.sleep(0.02)
    return None, None


def _quit(p):
    try:
        _send(p, id=0, command="quit")
    except Exception:
        pass
    time.sleep(0.2)
    p.kill()


def test_slow_command_does_not_block_ping():
    """A trivial ping must answer quickly even while a slow command is running."""
    p, recv = _spawn()
    try:
        _send(p, id=10, command="verify_key", provider="openai",
              api_key="x", base_url=BLACKHOLE)
        time.sleep(0.05)
        ping_sent = time.time()
        _send(p, id=11, command="ping")
        t, m = _wait_for(recv, 11, timeout=4)
        assert m is not None, "ping was never answered"
        latency = t - ping_sent
        assert latency < 2.0, (
            f"ping blocked {latency:.1f}s behind the slow command "
            f"(head-of-line blocking not fixed)"
        )
    finally:
        _quit(p)


def test_slow_command_still_completes():
    """The slow command itself must still resolve (off-thread, not dropped)."""
    p, recv = _spawn()
    try:
        _send(p, id=20, command="verify_key", provider="openai",
              api_key="x", base_url=BLACKHOLE)
        t, m = _wait_for(recv, 20, timeout=20)
        assert m is not None, "verify_key never resolved"
        # unreachable host -> reported as not valid / failed, but it MUST answer
        assert m.get("id") == 20
    finally:
        _quit(p)


def test_reader_stays_responsive_during_recording():
    """A lightweight ping must answer fast while a recording is active — the
    recording lane now runs off the reader thread."""
    p, recv = _spawn()
    try:
        _send(p, id=29, command="list_mics")
        _t, mics_resp = _wait_for(recv, 29, timeout=5)
        mics = (mics_resp or {}).get("mics") or []
        if not mics:
            pytest.skip("no input devices in this environment")
        _send(p, id=28, command="set_mic", device_id=mics[0]["id"])
        _wait_for(recv, 28, timeout=3)
        _send(p, id=30, command="start_rec")
        _t, m_start = _wait_for(recv, 30, timeout=12)
        if m_start is None or m_start.get("status") != "ok":
            pytest.skip(f"could not open an input device: {m_start}")
        ping_sent = time.time()
        _send(p, id=31, command="ping")
        t, m = _wait_for(recv, 31, timeout=2)
        assert m is not None, "ping not answered while recording"
        assert t - ping_sent < 1.0, "reader blocked during recording"
        _send(p, id=32, command="stop_rec")
        _wait_for(recv, 32, timeout=6)
    finally:
        _quit(p)
