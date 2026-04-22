"""
Single-gatekeeper regression: every Claude call passes through
enforce_call_limits. These tests exercise each hard cap in isolation so
a regression that bypasses one check will fail here loudly.
"""

from unittest.mock import patch

import pytest

from app.services import llm_client
from app.services.llm_client import CallLimitExceeded, BudgetExceededError, enforce_call_limits


SONNET = "claude-sonnet-4-6-20250415"
HAIKU = "claude-haiku-4-5-20251001"


def _no_soft_budget_check():
    """Patch out the DB-backed soft-limit check so hard-cap tests stay
    hermetic and don't spin up a database."""
    return patch.object(llm_client, "_check_budget", return_value=None)


# ── Hard caps ──

def test_happy_path_no_raise(monkeypatch):
    monkeypatch.setattr(llm_client.settings, "hard_max_cost_per_call_usd", 1.0)
    monkeypatch.setattr(llm_client.settings, "hard_max_tokens_per_call", 2000)
    monkeypatch.setattr(llm_client.settings, "hard_max_prompt_chars", 12000)

    with _no_soft_budget_check():
        enforce_call_limits(SONNET, max_tokens=500, prompt_text="hello", user_id=1)
    # No exception = pass.


def test_prompt_chars_hard_cap(monkeypatch):
    monkeypatch.setattr(llm_client.settings, "hard_max_prompt_chars", 100)

    with _no_soft_budget_check(), pytest.raises(CallLimitExceeded) as exc:
        enforce_call_limits(SONNET, max_tokens=500, prompt_text="x" * 200, user_id=1)

    assert exc.value.limit_type == "prompt_chars"
    assert exc.value.current == 200
    assert exc.value.cap == 100


def test_max_tokens_hard_cap(monkeypatch):
    monkeypatch.setattr(llm_client.settings, "hard_max_tokens_per_call", 1000)

    with _no_soft_budget_check(), pytest.raises(CallLimitExceeded) as exc:
        enforce_call_limits(SONNET, max_tokens=5000, prompt_text="hi", user_id=1)

    assert exc.value.limit_type == "max_tokens"
    assert exc.value.current == 5000
    assert exc.value.cap == 1000


def test_per_call_cost_hard_cap(monkeypatch):
    # Sonnet output is $15/M tokens. 10_000 tokens = $0.15.
    # Set the cap to $0.05 → the call must be rejected.
    monkeypatch.setattr(llm_client.settings, "hard_max_cost_per_call_usd", 0.05)
    monkeypatch.setattr(llm_client.settings, "hard_max_tokens_per_call", 100000)

    with _no_soft_budget_check(), pytest.raises(CallLimitExceeded) as exc:
        enforce_call_limits(SONNET, max_tokens=10000, prompt_text="hi", user_id=1)

    assert exc.value.limit_type == "per_call_cost"
    assert exc.value.cap == 0.05
    assert exc.value.current > 0.05


def test_haiku_cheaper_passes_where_sonnet_fails(monkeypatch):
    """Per-model pricing: 10k Haiku output tokens = $0.05, right at the cap;
    10k Sonnet output tokens = $0.15. Haiku passes, Sonnet fails."""
    monkeypatch.setattr(llm_client.settings, "hard_max_cost_per_call_usd", 0.06)
    monkeypatch.setattr(llm_client.settings, "hard_max_tokens_per_call", 100000)

    with _no_soft_budget_check():
        enforce_call_limits(HAIKU, max_tokens=10000, prompt_text="hi", user_id=1)  # passes

    with _no_soft_budget_check(), pytest.raises(CallLimitExceeded) as exc:
        enforce_call_limits(SONNET, max_tokens=10000, prompt_text="hi", user_id=1)  # fails
    assert exc.value.limit_type == "per_call_cost"


# ── Soft-limit delegation ──

def test_soft_budget_raises_same_exception(monkeypatch):
    """_check_budget's verdict must surface as CallLimitExceeded, not a
    different exception type — so downstream handlers don't need two
    try/except branches."""
    monkeypatch.setattr(llm_client.settings, "hard_max_prompt_chars", 100000)
    monkeypatch.setattr(llm_client.settings, "hard_max_tokens_per_call", 100000)
    monkeypatch.setattr(llm_client.settings, "hard_max_cost_per_call_usd", 100.0)

    fake_verdict = {"exceeded": "daily", "spent": 6.0, "limit": 5.0}
    with patch.object(llm_client, "_check_budget", return_value=fake_verdict), \
         pytest.raises(CallLimitExceeded) as exc:
        enforce_call_limits(SONNET, max_tokens=100, prompt_text="hi", user_id=1)

    assert exc.value.limit_type == "daily"
    assert exc.value.current == 6.0
    assert exc.value.cap == 5.0


# ── Backward compat ──

def test_budget_exceeded_error_is_alias_for_call_limit_exceeded():
    """Old code that does `except BudgetExceededError` must still catch
    the new exception class."""
    assert BudgetExceededError is CallLimitExceeded


def test_exceeded_type_attribute_preserved(monkeypatch):
    """Old handlers that inspect `.exceeded_type` must keep working."""
    monkeypatch.setattr(llm_client.settings, "hard_max_prompt_chars", 10)

    with _no_soft_budget_check(), pytest.raises(CallLimitExceeded) as exc:
        enforce_call_limits(SONNET, max_tokens=100, prompt_text="x" * 20, user_id=1)
    assert exc.value.exceeded_type == "prompt_chars"
    assert exc.value.exceeded_type == exc.value.limit_type


# ── Order-of-checks: cheapest first ──

def test_prompt_length_checked_before_db(monkeypatch):
    """If the prompt is already too long, enforce_call_limits must bail
    before hitting the DB — _check_budget is expensive and a bad prompt
    shouldn't cost a query."""
    monkeypatch.setattr(llm_client.settings, "hard_max_prompt_chars", 10)

    budget_called = {"n": 0}
    def counting_check(**kwargs):
        budget_called["n"] += 1
        return None

    with patch.object(llm_client, "_check_budget", side_effect=counting_check), \
         pytest.raises(CallLimitExceeded):
        enforce_call_limits(SONNET, max_tokens=100, prompt_text="x" * 100, user_id=1)

    assert budget_called["n"] == 0, "DB budget check must not run when hard caps reject first"
