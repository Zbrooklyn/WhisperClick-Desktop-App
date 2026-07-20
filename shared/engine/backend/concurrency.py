"""Small concurrency helpers shared by the engine.

run_with_timeout bounds a blocking call (e.g. opening an audio device that has
gone stale) so it can report a clean error instead of freezing the engine. The
worker is a daemon thread: if the call never returns, the thread is abandoned
and dies with the process rather than wedging it.
"""
import threading


class OperationTimeout(Exception):
    """Raised when a call wrapped by run_with_timeout exceeds its deadline."""


def run_with_timeout(fn, timeout, *args, **kwargs):
    """Run fn(*args, **kwargs), raising OperationTimeout if it exceeds `timeout`
    seconds. Exceptions raised by fn propagate to the caller unchanged."""
    box = {}

    def target():
        try:
            box["value"] = fn(*args, **kwargs)
        except BaseException as exc:  # noqa: BLE001 - re-raised on the caller thread
            box["error"] = exc

    worker = threading.Thread(target=target, daemon=True)
    worker.start()
    worker.join(timeout)
    if worker.is_alive():
        raise OperationTimeout(f"operation did not complete within {timeout}s")
    if "error" in box:
        raise box["error"]
    return box.get("value")
