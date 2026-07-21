"""Unit tests for the run_with_timeout watchdog (R3 in-engine timeout)."""
import time

import pytest

from backend.concurrency import OperationTimeout, run_with_timeout


def test_fast_call_returns_value():
    assert run_with_timeout(lambda: 42, 1.0) == 42


def test_slow_call_raises_timeout():
    def slow():
        time.sleep(3)
        return "done"

    start = time.time()
    with pytest.raises(OperationTimeout):
        run_with_timeout(slow, 0.3)
    # must give up near the timeout, not wait for the slow call to finish
    assert time.time() - start < 1.5


def test_callee_exception_propagates():
    def boom():
        raise ValueError("nope")

    with pytest.raises(ValueError):
        run_with_timeout(boom, 1.0)


def test_args_are_forwarded():
    assert run_with_timeout(lambda a, b: a + b, 1.0, 2, 3) == 5
