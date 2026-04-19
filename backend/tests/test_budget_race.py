"""
Regression test for the budget/rate-limit race condition the hostile QA
pass found. Before the fix, N concurrent callers could all observe
count<limit simultaneously and all proceed, blowing past the limit.

The fix: check-and-reserve under a single process-wide lock, so the
reservation INSERT serialises concurrent callers.
"""

import threading
from unittest.mock import patch

from app.services import llm_client
from app.models import APIUsageLog


def test_concurrent_calls_respect_user_rate_limit(db, admin_user, monkeypatch):
    """
    Fire 20 concurrent _make_api_call invocations. With user_rate_limit=5,
    at most 5 should reach the actual API call; the rest must raise
    BudgetExceededError.
    """
    # Tight user rate limit so the test is decisive
    monkeypatch.setattr(llm_client.settings, "api_max_calls_per_user_per_minute", 5)
    monkeypatch.setattr(llm_client.settings, "api_max_calls_per_minute", 1000)
    monkeypatch.setattr(llm_client.settings, "api_daily_budget", 100.0)
    monkeypatch.setattr(llm_client.settings, "api_monthly_budget", 1000.0)

    api_call_count = {"value": 0}
    lock = threading.Lock()

    class _FakeResponse:
        class _U:
            input_tokens = 10
            output_tokens = 10
        usage = _U()
        class _C:
            text = "hi"
        content = [_C()]

    def fake_messages_create(**_):
        with lock:
            api_call_count["value"] += 1
        return _FakeResponse()

    # Patch the Anthropic client
    class _FakeClient:
        class messages:
            create = staticmethod(fake_messages_create)

    monkeypatch.setattr(llm_client, "_get_client", lambda: _FakeClient())

    # Also stub safety scan so we don't need to set it up
    monkeypatch.setattr(
        "app.services.safety.scan_input",
        lambda _: {"safe": True, "flags": [], "risk_score": 0},
    )
    monkeypatch.setattr(
        "app.services.safety.scan_output",
        lambda _: {"flags": []},
    )

    errors = []
    successes = []

    def worker():
        try:
            llm_client._make_api_call(
                caller="test", model="m", max_tokens=50,
                messages=[{"role": "user", "content": "hi"}],
                user_id=admin_user.id, max_retries=0,
            )
            successes.append(True)
        except llm_client.BudgetExceededError:
            errors.append("budget")
        except Exception as exc:
            errors.append(repr(exc))

    threads = [threading.Thread(target=worker) for _ in range(20)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()

    # At most 5 should have succeeded; the rest must have been BudgetExceeded.
    # The race-condition bug would let ALL 20 succeed.
    # Surface any unexpected error types to aid debugging
    unexpected = [e for e in errors if e != "budget"]
    assert not unexpected, f"Unexpected errors: {unexpected[:3]}"

    assert len(successes) <= 5, (
        f"Budget race: {len(successes)} calls succeeded but limit is 5"
    )
    assert len(successes) + len([e for e in errors if e == "budget"]) == 20
