"""R9: the engine's raw-stderr log must be size-capped (rotate at 5 MB).

Runs the engine with WHISPERCLICK_CONFIG_DIR pointed at a temp dir, so the
real shared log is never touched.
"""
import os
import shutil
import subprocess
import sys
import tempfile
import threading
import time

ENGINE = os.path.join(os.path.dirname(os.path.dirname(__file__)), "engine.py")
CAP = 5 * 1024 * 1024


def _boot(config_dir):
    env = dict(os.environ, WHISPERCLICK_CONFIG_DIR=config_dir)
    p = subprocess.Popen(
        [sys.executable, "-u", ENGINE],
        stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
        cwd=os.path.dirname(ENGINE), text=True, bufsize=1, env=env,
    )
    ready = threading.Event()

    def reader():
        for line in p.stdout:
            if '"ready"' in line:
                ready.set()
    threading.Thread(target=reader, daemon=True).start()
    assert ready.wait(15), "engine did not boot"
    try:
        p.stdin.write('{"id":0,"command":"quit"}\n')
        p.stdin.flush()
    except Exception:
        pass
    time.sleep(0.2)
    p.kill()


def test_oversized_log_is_rotated():
    tmp = tempfile.mkdtemp(prefix="wc-logtest-")
    try:
        logp = os.path.join(tmp, "engine.log")
        with open(logp, "wb") as f:
            f.write(b"x" * (CAP + 1024 * 1024))  # 6 MB > cap
        _boot(tmp)
        assert os.path.exists(logp + ".1"), "oversized log was not rotated to .1"
        assert os.path.getsize(logp) < CAP, "current log is not fresh after rotation"
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


def test_small_log_is_not_rotated():
    tmp = tempfile.mkdtemp(prefix="wc-logtest-")
    try:
        logp = os.path.join(tmp, "engine.log")
        with open(logp, "wb") as f:
            f.write(b"small\n")
        _boot(tmp)
        assert not os.path.exists(logp + ".1"), "small log should not rotate"
    finally:
        shutil.rmtree(tmp, ignore_errors=True)
