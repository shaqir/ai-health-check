"""
Synthesis contract — structured errors must surface as HTTP, not draft
content.

`generate_summary`, `generate_dashboard_insight`, and
`generate_compliance_summary` used to catch `except Exception` and
return the error string inside the draft field. That meant a budget
exhaustion or safety block during LLM drafting ended up in the HITL
approver's view as if it were content — mechanically approvable.

After the B2 fix, the three functions:
  * re-raise `CallLimitExceeded` and `PromptSafetyError` so the global
    FastAPI exception handlers in main.py map them to 402 / 413 / 422
    / 429, and
  * still catch generic `Exception` for transient Anthropic failures
    (timeouts, 5xx, network) so a flaky API doesn't wipe the HITL flow.
"""

import asyncio
from unittest.mock import patch

import pytest

from app.services.llm_client import (
    CallLimitExceeded,
    generate_compliance_summary,
    generate_dashboard_insight,
    generate_summary,
    judge_response,
    run_eval_prompt,
)
from app.services.safety import PromptSafetyError


# ── Structured errors re-raise ──────────────────────────────────────

def test_generate_summary_reraises_call_limit_exceeded():
    """Daily-budget exhaustion during incident summary → propagate to
    global handler (402), not a fake draft."""
    with patch(
        "app.services.llm_client._make_api_call",
        side_effect=CallLimitExceeded("daily", 5.01, 5.0),
    ):
        with pytest.raises(CallLimitExceeded):
            asyncio.run(generate_summary("svc", "high", "symptoms", {}))


def test_generate_dashboard_insight_reraises_prompt_safety_error():
    """A safety block during dashboard drafting → propagate to 422, not
    a draft that says "blocked: injection_attempt"."""
    with patch(
        "app.services.llm_client._make_api_call",
        side_effect=PromptSafetyError(
            "blocked", flags=["injection_attempt"], risk_score=90,
        ),
    ):
        with pytest.raises(PromptSafetyError):
            asyncio.run(generate_dashboard_insight({}))


def test_generate_compliance_summary_reraises_rate_limit():
    """Rate-limit during compliance report → propagate to 429."""
    with patch(
        "app.services.llm_client._make_api_call",
        side_effect=CallLimitExceeded("rate_limit", 31, 30),
    ):
        with pytest.raises(CallLimitExceeded):
            asyncio.run(generate_compliance_summary([], [], []))


# ── Fallback UX preserved for transient errors ──────────────────────

def test_generate_summary_still_returns_error_draft_on_transient_failure():
    """A generic Exception (e.g. Anthropic 5xx after retries, network
    blip) must NOT propagate — it falls back to the draft-with-error
    text so the HITL flow survives a flaky API. This guards against
    the re-raise refactor over-correcting."""
    with patch(
        "app.services.llm_client._make_api_call",
        side_effect=RuntimeError("simulated transient upstream failure"),
    ):
        result = asyncio.run(generate_summary("svc", "high", "syms", {}))

    assert isinstance(result, dict)
    assert "summary_draft" in result
    assert "Error generating summary" in result["summary_draft"]
    assert result["root_causes_draft"] == ""


def test_generate_dashboard_insight_still_returns_error_draft_on_transient_failure():
    with patch(
        "app.services.llm_client._make_api_call",
        side_effect=RuntimeError("simulated transient upstream failure"),
    ):
        result = asyncio.run(generate_dashboard_insight({}))

    assert isinstance(result, dict)
    assert "insight_text" in result
    assert "Error generating insight" in result["insight_text"]


def test_generate_compliance_summary_still_returns_error_draft_on_transient_failure():
    with patch(
        "app.services.llm_client._make_api_call",
        side_effect=RuntimeError("simulated transient upstream failure"),
    ):
        result = asyncio.run(generate_compliance_summary([], [], []))

    assert isinstance(result, dict)
    assert "report_text" in result
    assert "Error generating compliance report" in result["report_text"]


# ── Eval-path contract ──────────────────────────────────────────────
# Same two-clause split as the three synthesis functions. Mid-eval
# budget/safety must abort the run (propagate to 429/422) instead of
# silently filling EvalResults with all-ERROR rows and a fake 0 score;
# transient failures keep the ERROR-branch + judge_refused fallbacks
# so a single flaky call doesn't tank the whole run.

def test_run_eval_prompt_reraises_call_limit_exceeded():
    with patch(
        "app.services.llm_client._make_api_call",
        side_effect=CallLimitExceeded("daily", 5.01, 5.0),
    ):
        with pytest.raises(CallLimitExceeded):
            asyncio.run(run_eval_prompt("any prompt"))


def test_run_eval_prompt_reraises_prompt_safety_error():
    with patch(
        "app.services.llm_client._make_api_call",
        side_effect=PromptSafetyError(
            "blocked", flags=["injection_attempt"], risk_score=90,
        ),
    ):
        with pytest.raises(PromptSafetyError):
            asyncio.run(run_eval_prompt("any prompt"))


def test_run_eval_prompt_still_returns_error_text_on_transient_failure():
    """Network/5xx must keep the 'ERROR: ...' fallback so eval_runner's
    ERROR-branch short-circuit (09920a3) skips the judge for this case
    without aborting the whole run."""
    with patch(
        "app.services.llm_client._make_api_call",
        side_effect=RuntimeError("simulated transient upstream failure"),
    ):
        result = asyncio.run(run_eval_prompt("any prompt"))

    assert result["response_text"].startswith("ERROR:")
    assert result["latency_ms"] == 0


def test_judge_response_reraises_call_limit_exceeded():
    with patch(
        "app.services.llm_client._make_api_call",
        side_effect=CallLimitExceeded("daily", 5.01, 5.0),
    ):
        with pytest.raises(CallLimitExceeded):
            asyncio.run(judge_response("prompt", "expected", "actual"))


def test_judge_response_reraises_prompt_safety_error():
    with patch(
        "app.services.llm_client._make_api_call",
        side_effect=PromptSafetyError(
            "blocked", flags=["injection_attempt"], risk_score=90,
        ),
    ):
        with pytest.raises(PromptSafetyError):
            asyncio.run(judge_response("prompt", "expected", "actual"))


def test_judge_response_still_returns_none_on_transient_failure():
    """A judge timeout / malformed response must keep returning
    {factuality: None, hallucination: None} so eval_runner tags the row
    'judge_refused' and excludes it from aggregation — the run survives
    one bad judge call."""
    with patch(
        "app.services.llm_client._make_api_call",
        side_effect=RuntimeError("simulated transient upstream failure"),
    ):
        result = asyncio.run(judge_response("prompt", "expected", "actual"))

    assert result == {"factuality": None, "hallucination": None}
