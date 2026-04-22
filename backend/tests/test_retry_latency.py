"""
Regression for Bug 5: reported latency must be wall-clock time across
retries, not per-attempt. Before this fix, if attempt 0 hit a
RateLimitError and we slept ~1.5s before attempt 1 succeeded in 200ms,
the UI showed 200ms even though the user waited 1.7s total.
"""

import time
from unittest.mock import MagicMock, patch

import anthropic
import pytest

from app.services import llm_client


def _fake_response():
    r = MagicMock()
    r.content = [MagicMock(text="ok")]
    r.usage.input_tokens = 1
    r.usage.output_tokens = 1
    return r


class _FakeBudgetLock:
    def __enter__(self): return self
    def __exit__(self, *a): return False


def _neutralize_lock_and_db(monkeypatch):
    """Bypass the DB-backed budget + reservation layer so this test stays
    unit-scoped and doesn't need a sqlite fixture."""
    monkeypatch.setattr(llm_client, "_BUDGET_LOCK", _FakeBudgetLock())
    monkeypatch.setattr(llm_client, "enforce_call_limits", lambda **kw: None)
    monkeypatch.setattr(llm_client, "_reserve_slot", lambda *a, **k: 1)
    monkeypatch.setattr(llm_client, "_finalize_reservation", lambda *a, **k: None)


def test_latency_includes_retry_backoff(monkeypatch):
    """Attempt 0 raises RateLimitError (which triggers sleep ~1s+jitter),
    attempt 1 succeeds. The reported latency must be total wall time, not
    just the successful attempt's time."""
    _neutralize_lock_and_db(monkeypatch)
    # Silence the safety scanner — not what's under test here.
    monkeypatch.setattr("app.services.safety.scan_input",
                        lambda t: {"safe": True, "flags": [], "risk_score": 0, "details": {}})
    monkeypatch.setattr("app.services.safety.scan_output",
                        lambda t: {"safe": True, "flags": [], "pii_detected": False})

    fake_client = MagicMock()
    # Keep the retry backoff predictable and fast: override the
    # module's `time.sleep` with a fixed 500ms real sleep. Capture the
    # *original* builtin first so the mock doesn't recursively call
    # itself (monkeypatch replaces time.sleep module-wide).
    real_sleep = time.sleep
    monkeypatch.setattr(llm_client.time, "sleep", lambda s: real_sleep(0.5))

    calls = {"n": 0}
    def messages_create(**kwargs):
        calls["n"] += 1
        if calls["n"] == 1:
            raise anthropic.RateLimitError(
                "rate limited",
                response=MagicMock(status_code=429),
                body=None,
            )
        return _fake_response()
    fake_client.messages.create = messages_create

    monkeypatch.setattr(llm_client, "_get_client", lambda: fake_client)

    _, reported_ms = llm_client._make_api_call(
        caller="test", model="claude-sonnet-4-6-20250415",
        max_tokens=10, messages=[{"role": "user", "content": "hi"}],
    )

    # The 500ms sleep is the dominant term; reported latency must include
    # it (>=500). Old behavior was per-attempt only and would report ~0ms
    # since the successful mock call returns instantly.
    assert reported_ms >= 450, (
        f"reported latency {reported_ms}ms excludes retry backoff "
        f"(expected >=450ms from the 500ms sleep)"
    )
    assert calls["n"] == 2, "expected exactly 2 attempts (1 fail, 1 succeed)"


def test_latency_happy_path_no_retry(monkeypatch):
    """Sanity: first-attempt success still reports a sensible latency
    (the API-call duration itself, no retry sleep component)."""
    _neutralize_lock_and_db(monkeypatch)
    monkeypatch.setattr("app.services.safety.scan_input",
                        lambda t: {"safe": True, "flags": [], "risk_score": 0, "details": {}})
    monkeypatch.setattr("app.services.safety.scan_output",
                        lambda t: {"safe": True, "flags": [], "pii_detected": False})

    fake_client = MagicMock()
    fake_client.messages.create = lambda **kw: _fake_response()
    monkeypatch.setattr(llm_client, "_get_client", lambda: fake_client)

    _, reported_ms = llm_client._make_api_call(
        caller="test", model="claude-sonnet-4-6-20250415",
        max_tokens=10, messages=[{"role": "user", "content": "hi"}],
    )

    # Mock returns instantly; should be a tiny positive number, well under
    # the 200ms threshold we'd expect even with slow machines.
    assert 0 <= reported_ms < 200
