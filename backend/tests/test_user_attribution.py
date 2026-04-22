"""
Regression for Bug 1 + Bug 2: every public LLM function must forward
user_id + service_id (where applicable) to _make_api_call, so usage log
rows are attributable and per-user rate limiting can actually fire.

Each test patches _make_api_call, calls the public function with
user_id=7 (and service_id=42 where accepted), and asserts the captured
kwargs include those values verbatim.
"""

import asyncio
from unittest.mock import MagicMock, patch

from app.services import llm_client


def _fake_response(text: str = "ok"):
    r = MagicMock()
    r.content = [MagicMock(text=text)]
    r.usage.input_tokens = 10
    r.usage.output_tokens = 5
    return r


def _capture_kwargs():
    """Returns (fake_make, captured_dict). captured holds the last kwargs
    _make_api_call was invoked with."""
    captured = {}

    def fake_make(caller, model, max_tokens, messages, **kwargs):
        captured["caller"] = caller
        captured.update(kwargs)
        return _fake_response('{"factuality": 90, "hallucination": 5}'), 100.0

    return fake_make, captured


def test_test_connection_forwards_user_and_service_id():
    fake_make, captured = _capture_kwargs()
    with patch.object(llm_client, "_make_api_call", side_effect=fake_make):
        asyncio.run(llm_client.test_connection(user_id=7, service_id=42))
    assert captured["user_id"] == 7
    assert captured["service_id"] == 42
    assert captured["caller"] == "test_connection"


def test_run_eval_prompt_forwards_user_and_service_id():
    fake_make, captured = _capture_kwargs()
    with patch.object(llm_client, "_make_api_call", side_effect=fake_make):
        asyncio.run(llm_client.run_eval_prompt("p", user_id=7, service_id=42))
    assert captured["user_id"] == 7
    assert captured["service_id"] == 42


def test_judge_response_forwards_user_and_service_id():
    fake_make, captured = _capture_kwargs()
    with patch.object(llm_client, "_make_api_call", side_effect=fake_make):
        asyncio.run(llm_client.judge_response("p", "e", "a", user_id=7, service_id=42))
    assert captured["user_id"] == 7
    assert captured["service_id"] == 42


def test_generate_summary_forwards_user_and_service_id():
    fake_make, captured = _capture_kwargs()
    with patch.object(llm_client, "_make_api_call", side_effect=fake_make):
        asyncio.run(llm_client.generate_summary(
            "svc", "high", "down", {"restart": True},
            user_id=7, service_id=42,
        ))
    assert captured["user_id"] == 7
    assert captured["service_id"] == 42


def test_generate_dashboard_insight_forwards_user_id():
    """Dashboard insight is not service-scoped, so only user_id threads."""
    fake_make, captured = _capture_kwargs()
    with patch.object(llm_client, "_make_api_call", side_effect=fake_make):
        asyncio.run(llm_client.generate_dashboard_insight({}, user_id=7))
    assert captured["user_id"] == 7
    assert "service_id" not in captured


def test_generate_compliance_summary_forwards_user_id():
    """Compliance report is org-wide, not service-scoped."""
    fake_make, captured = _capture_kwargs()
    with patch.object(llm_client, "_make_api_call", side_effect=fake_make):
        asyncio.run(llm_client.generate_compliance_summary([], [], [], user_id=7))
    assert captured["user_id"] == 7
    assert "service_id" not in captured


def test_backward_compat_user_id_optional():
    """Legacy callers that don't pass user_id still work (None is allowed)."""
    fake_make, captured = _capture_kwargs()
    with patch.object(llm_client, "_make_api_call", side_effect=fake_make):
        asyncio.run(llm_client.test_connection())
    # user_id was forwarded, just as None
    assert captured.get("user_id") is None


def test_test_connection_propagates_call_limit_exceeded():
    """Bug 4: limit violations must NOT be swallowed into a 'failure' card —
    they need to reach the FastAPI handler so the UI gets a proper
    402/413/422/429 response."""
    def raise_limit(*args, **kwargs):
        raise llm_client.CallLimitExceeded("daily", 5.01, 5.0)

    with patch.object(llm_client, "_make_api_call", side_effect=raise_limit):
        try:
            asyncio.run(llm_client.test_connection(user_id=7))
        except llm_client.CallLimitExceeded as exc:
            assert exc.limit_type == "daily"
            return
        raise AssertionError("test_connection swallowed CallLimitExceeded")


def test_test_connection_propagates_prompt_safety_error():
    """PromptSafetyError must propagate for the same reason — global handler
    maps it to HTTP 422 with structured safety_flags."""
    from app.services.safety import PromptSafetyError

    def raise_safety(*args, **kwargs):
        raise PromptSafetyError("blocked", flags=["injection_attempt"], risk_score=90)

    with patch.object(llm_client, "_make_api_call", side_effect=raise_safety):
        try:
            asyncio.run(llm_client.test_connection(user_id=7))
        except PromptSafetyError as exc:
            assert "injection_attempt" in exc.flags
            return
        raise AssertionError("test_connection swallowed PromptSafetyError")
