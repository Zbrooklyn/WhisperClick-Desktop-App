"""R7: expired-audio cleanup runs (off the reader thread) on configure.

Uses WHISPERCLICK_CONFIG_DIR to point the engine at a temp dir, so the real
audio dir is never touched.
"""
import json
import os
import shutil
import subprocess
import sys
import tempfile
import threading
import time

ENGINE = os.path.join(os.path.dirname(os.path.dirname(__file__)), "engine.py")


def test_configure_cleans_expired_audio():
    tmp = tempfile.mkdtemp(prefix="wc-cleanup-")
    try:
        audio = os.path.join(tmp, "audio")
        os.makedirs(audio)
        old = os.path.join(audio, "old.ogg")
        fresh = os.path.join(audio, "fresh.ogg")
        for f in (old, fresh):
            with open(f, "wb") as fh:
                fh.write(b"x")
        old_t = time.time() - 40 * 86400  # 40 days old
        os.utime(old, (old_t, old_t))

        env = dict(os.environ, WHISPERCLICK_CONFIG_DIR=tmp)
        p = subprocess.Popen(
            [sys.executable, "-u", ENGINE],
            stdin=subprocess.PIPE, stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL, cwd=os.path.dirname(ENGINE),
            text=True, bufsize=1, env=env,
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
                recv.append(m)
                if m.get("event") == "ready":
                    ready.set()
        threading.Thread(target=reader, daemon=True).start()
        assert ready.wait(15), "engine did not boot"

        p.stdin.write(json.dumps({"id": 1, "command": "configure",
                                  "audio_retention_days": 30}) + "\n")
        p.stdin.flush()

        # configure must answer ok ...
        deadline = time.time() + 5
        resp = None
        while time.time() < deadline:
            resp = next((m for m in list(recv) if m.get("id") == 1), None)
            if resp:
                break
            time.sleep(0.02)
        assert resp and resp["status"] == "ok"

        # ... and the expired file must get deleted by the background cleanup.
        deadline = time.time() + 5
        while os.path.exists(old) and time.time() < deadline:
            time.sleep(0.1)
        assert not os.path.exists(old), "expired audio not deleted"
        assert os.path.exists(fresh), "fresh audio wrongly deleted"

        try:
            p.stdin.write('{"id":0,"command":"quit"}\n')
            p.stdin.flush()
        except Exception:
            pass
        time.sleep(0.2)
        p.kill()
    finally:
        shutil.rmtree(tmp, ignore_errors=True)
