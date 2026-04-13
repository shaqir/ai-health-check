"""
LLM REST Wrapper — llm/client.py

ALL LLM calls go through this module. No route handler ever
touches the Anthropic SDK directly. This makes it easy to:
  1. Swap providers (Anthropic → OpenAI → Ollama) by changing ONE file
  2. Add logging, rate limiting, or caching in one place
  3. Mock for testing

Functions:
  - test_connection()               → Used by Module 1 (Service Registry)
  - run_eval_prompt()               → Used by Module 2 (Evaluation Harness)
  - score_factuality()              → Used by Module 2 (Evaluation Scoring)
  - generate_summary()              → Used by Module 3 (Incident Triage)
  - generate_dashboard_insight()    → Used by Module 2 (Dashboard AI Summary)
  - generate_compliance_summary()   → Used by Module 4 (Compliance AI Report)
"""

import json
import random as _random
import re
import time
from datetime import datetime, timedelta, timezone

import anthropic
from app.config import get_settings
from app.database import SessionLocal

settings = get_settings()

# Initialize the Anthropic client once
_client = None

# Claude Sonnet 4.6 pricing (per million tokens)
_PRICING = {
    "input_per_million": 3.0,
    "output_per_million": 15.0,
}

# Errors worth retrying (transient failures)
_RETRYABLE_ERRORS = (
    anthropic.RateLimitError,
    anthropic.APIConnectionError,
    anthropic.InternalServerError,
)


class BudgetExceededError(Exception):
    """Raised when API budget or rate limit is exceeded."""
    def __init__(self, message: str, exceeded_type: str = "daily"):
        super().__init__(message)
        self.exceeded_type = exceeded_type


def _get_client() -> anthropic.Anthropic:
    """Lazy-initialize the Anthropic client with timeout."""
    global _client
    if _client is None:
        _client = anthropic.Anthropic(
            api_key=settings.anthropic_api_key,
            timeout=float(settings.llm_timeout_seconds),
        )
    return _client


def _estimate_cost(input_tokens: int, output_tokens: int) -> float:
    """Estimate cost in USD from token counts."""
    input_cost = (input_tokens / 1_000_000) * _PRICING["input_per_million"]
    output_cost = (output_tokens / 1_000_000) * _PRICING["output_per_million"]
    return round(input_cost + output_cost, 6)


def _log_usage(
    caller: str, model: str,
    input_tokens: int, output_tokens: int,
    latency_ms: float, status: str = "success",
    user_id: int | None = None,
    safety_flags: str = "", risk_score: int = 0,
):
    """Write an API usage record to the database."""
    from app.models import APIUsageLog

    total = input_tokens + output_tokens
    cost = _estimate_cost(input_tokens, output_tokens)

    db = SessionLocal()
    try:
        db.add(APIUsageLog(
            user_id=user_id,
            caller=caller,
            model=model,
            input_tokens=input_tokens,
            output_tokens=output_tokens,
            total_tokens=total,
            estimated_cost_usd=cost,
            latency_ms=latency_ms,
            status=status,
            safety_flags=safety_flags,
            risk_score=risk_score,
        ))
        db.commit()
    except Exception:
        db.rollback()
    finally:
        db.close()


def _check_budget(user_id: int | None = None) -> dict | None:
    """
    Check budget limits, global rate limits, and per-user rate limits.
    Returns None if all clear, or a dict with details if any limit exceeded.
    """
    from app.models import APIUsageLog
    from sqlalchemy import func

    db = SessionLocal()
    try:
        now = datetime.now(timezone.utc)
        one_min_ago = now - timedelta(minutes=1)

        # Per-user rate limit
        if user_id and settings.api_max_calls_per_user_per_minute > 0:
            user_calls = db.query(func.count(APIUsageLog.id)).filter(
                APIUsageLog.timestamp >= one_min_ago,
                APIUsageLog.user_id == user_id,
            ).scalar()
            if user_calls >= settings.api_max_calls_per_user_per_minute:
                return {
                    "exceeded": "user_rate_limit",
                    "spent": user_calls,
                    "limit": settings.api_max_calls_per_user_per_minute,
                }

        # Global rate limit
        if settings.api_max_calls_per_minute > 0:
            recent_calls = db.query(func.count(APIUsageLog.id)).filter(
                APIUsageLog.timestamp >= one_min_ago,
            ).scalar()
            if recent_calls >= settings.api_max_calls_per_minute:
                return {
                    "exceeded": "rate_limit",
                    "spent": recent_calls,
                    "limit": settings.api_max_calls_per_minute,
                }

        # Daily budget
        if settings.api_daily_budget > 0:
            day_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
            daily_cost = db.query(func.coalesce(func.sum(APIUsageLog.estimated_cost_usd), 0)).filter(
                APIUsageLog.timestamp >= day_start,
            ).scalar()
            if daily_cost >= settings.api_daily_budget:
                return {
                    "exceeded": "daily",
                    "spent": round(daily_cost, 4),
                    "limit": settings.api_daily_budget,
                }

        # Monthly budget
        if settings.api_monthly_budget > 0:
            month_start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
            monthly_cost = db.query(func.coalesce(func.sum(APIUsageLog.estimated_cost_usd), 0)).filter(
                APIUsageLog.timestamp >= month_start,
            ).scalar()
            if monthly_cost >= settings.api_monthly_budget:
                return {
                    "exceeded": "monthly",
                    "spent": round(monthly_cost, 4),
                    "limit": settings.api_monthly_budget,
                }

        return None
    finally:
        db.close()


def _make_api_call(caller: str, model: str, max_tokens: int, messages: list,
                   max_retries: int = 2, user_id: int | None = None, **kwargs):
    """
    Centralized API call with safety scanning, budget enforcement, retry logic,
    categorized error logging, and per-user rate limiting.
    """
    from app.services.safety import scan_input, scan_output, PromptSafetyError

    # 1. Safety scan on input
    input_text = " ".join(
        m.get("content", "") for m in messages if isinstance(m, dict)
    )
    safety_result = scan_input(input_text)
    safety_flags_str = ",".join(safety_result["flags"])

    if not safety_result["safe"]:
        _log_usage(
            caller, model, 0, 0, 0, "blocked_safety",
            user_id=user_id, safety_flags=safety_flags_str,
            risk_score=safety_result["risk_score"],
        )
        raise PromptSafetyError(
            f"Prompt blocked by safety scanner: {', '.join(safety_result['flags'])}",
            flags=safety_result["flags"],
            risk_score=safety_result["risk_score"],
        )

    # 2. Budget and rate limit checks
    budget_check = _check_budget(user_id=user_id)
    if budget_check:
        exceeded = budget_check["exceeded"]
        if exceeded in ("rate_limit", "user_rate_limit"):
            raise BudgetExceededError(
                f"Rate limit exceeded: {budget_check['spent']} / {budget_check['limit']} calls/min. "
                f"Wait a moment and try again.",
                exceeded_type="rate_limit",
            )
        raise BudgetExceededError(
            f"API {exceeded} budget exceeded: "
            f"${budget_check['spent']:.4f} / ${budget_check['limit']:.2f}. "
            f"Increase the limit in .env or wait for the next period.",
            exceeded_type=exceeded,
        )

    # 3. Make the API call with retries
    client = _get_client()

    for attempt in range(max_retries + 1):
        start = time.time()
        try:
            response = client.messages.create(
                model=model,
                max_tokens=max_tokens,
                messages=messages,
                timeout=float(settings.llm_timeout_seconds),
                **kwargs,
            )
            latency_ms = round((time.time() - start) * 1000, 1)

            input_tokens = getattr(response.usage, "input_tokens", 0)
            output_tokens = getattr(response.usage, "output_tokens", 0)

            # 4. Safety scan on output
            output_text = response.content[0].text if response.content else ""
            output_scan = scan_output(output_text)
            if output_scan["flags"]:
                safety_flags_str += ("," if safety_flags_str else "") + ",".join(output_scan["flags"])

            _log_usage(
                caller, model, input_tokens, output_tokens, latency_ms, "success",
                user_id=user_id, safety_flags=safety_flags_str,
                risk_score=safety_result["risk_score"],
            )
            return response, latency_ms

        except anthropic.RateLimitError:
            latency_ms = round((time.time() - start) * 1000, 1)
            if attempt < max_retries:
                _log_usage(caller, model, 0, 0, latency_ms, f"retry_{attempt}", user_id=user_id)
                time.sleep((2 ** attempt) + _random.uniform(0, 0.5))
            else:
                _log_usage(caller, model, 0, 0, latency_ms, "error_rate_limit", user_id=user_id)
                raise

        except anthropic.APIConnectionError:
            latency_ms = round((time.time() - start) * 1000, 1)
            if attempt < max_retries:
                _log_usage(caller, model, 0, 0, latency_ms, f"retry_{attempt}", user_id=user_id)
                time.sleep((2 ** attempt) + _random.uniform(0, 0.5))
            else:
                _log_usage(caller, model, 0, 0, latency_ms, "error_timeout", user_id=user_id)
                raise

        except anthropic.InternalServerError:
            latency_ms = round((time.time() - start) * 1000, 1)
            if attempt < max_retries:
                _log_usage(caller, model, 0, 0, latency_ms, f"retry_{attempt}", user_id=user_id)
                time.sleep((2 ** attempt) + _random.uniform(0, 0.5))
            else:
                _log_usage(caller, model, 0, 0, latency_ms, "error_server", user_id=user_id)
                raise

        except anthropic.AuthenticationError:
            latency_ms = round((time.time() - start) * 1000, 1)
            _log_usage(caller, model, 0, 0, latency_ms, "error_auth", user_id=user_id)
            raise

        except anthropic.BadRequestError:
            latency_ms = round((time.time() - start) * 1000, 1)
            _log_usage(caller, model, 0, 0, latency_ms, "error_bad_request", user_id=user_id)
            raise

        except (BudgetExceededError, PromptSafetyError):
            raise

        except Exception:
            latency_ms = round((time.time() - start) * 1000, 1)
            _log_usage(caller, model, 0, 0, latency_ms, "error_unknown", user_id=user_id)
            raise


# ── Public API Functions ──


async def test_connection(prompt: str = "Say hello in exactly 5 words.", model: str = None) -> dict:
    """
    Module 1: Test Connection
    Sends a small prompt to Claude and measures latency.
    Returns: { status, latency_ms, response_snippet }
    """
    use_model = model or settings.llm_model
    try:
        response, latency_ms = _make_api_call(
            caller="test_connection",
            model=use_model,
            max_tokens=50,
            messages=[{"role": "user", "content": prompt}],
        )
        snippet = response.content[0].text[:200] if response.content else ""
        return {"status": "success", "latency_ms": latency_ms, "response_snippet": snippet}
    except Exception as e:
        return {"status": "failure", "latency_ms": 0, "response_snippet": str(e)[:200]}


async def run_eval_prompt(prompt: str, system_context: str = "") -> dict:
    """
    Module 2: Evaluation Harness
    Sends an eval test case prompt and returns the raw response.
    Returns: { response_text, latency_ms }
    """
    try:
        kwargs = {}
        if system_context:
            kwargs["system"] = system_context

        response, latency_ms = _make_api_call(
            caller="run_eval_prompt",
            model=settings.llm_model,
            max_tokens=settings.llm_max_tokens,
            messages=[{"role": "user", "content": prompt}],
            **kwargs,
        )
        text = response.content[0].text if response.content else ""
        return {"response_text": text, "latency_ms": latency_ms}
    except Exception as e:
        return {"response_text": f"ERROR: {str(e)}", "latency_ms": 0}


async def generate_summary(
    service_name: str,
    severity: str,
    symptoms: str,
    checklist: dict,
) -> dict:
    """
    Module 3: Incident Triage — LLM-assisted summary
    Returns: { summary_draft, root_causes_draft }
    """
    checklist_text = "\n".join(
        f"- {k}: {'Yes' if v else 'No'}" for k, v in checklist.items()
    )

    prompt = f"""You are an AI operations assistant. An incident has been reported.

Service: {service_name}
Severity: {severity}
Symptoms: {symptoms}

Troubleshooting checklist results:
{checklist_text}

Please provide:
1. A brief stakeholder update (2-3 sentences suitable for management)
2. Top 3 most likely root causes based on the symptoms and checklist

Format your response as:
STAKEHOLDER UPDATE:
[your update here]

ROOT CAUSES:
1. [cause 1]
2. [cause 2]
3. [cause 3]"""

    try:
        response, _ = _make_api_call(
            caller="generate_summary",
            model=settings.llm_model,
            max_tokens=settings.llm_max_tokens,
            messages=[{"role": "user", "content": prompt}],
        )
        text = response.content[0].text if response.content else ""

        summary_draft = text
        root_causes_draft = ""
        if "ROOT CAUSES:" in text:
            parts = text.split("ROOT CAUSES:")
            summary_draft = parts[0].replace("STAKEHOLDER UPDATE:", "").strip()
            root_causes_draft = parts[1].strip()

        return {"summary_draft": summary_draft, "root_causes_draft": root_causes_draft}
    except Exception as e:
        return {"summary_draft": f"Error generating summary: {str(e)}", "root_causes_draft": ""}


async def score_factuality(expected: str, actual: str) -> float:
    """
    Module 2: Evaluation Scoring
    Asks Claude to rate factual similarity 0-100.
    """
    prompt = f"""You are evaluating AI output quality. Compare the expected output with the actual output and rate their factual similarity on a scale of 0-100.

Expected output:
{expected}

Actual output:
{actual}

Respond with ONLY a single integer from 0 to 100. No other text."""

    try:
        response, _ = _make_api_call(
            caller="score_factuality",
            model=settings.llm_model,
            max_tokens=10,
            messages=[{"role": "user", "content": prompt}],
        )
        text = response.content[0].text.strip() if response.content else "0"
        match = re.search(r"\d+", text)
        score = int(match.group()) if match else 0
        return min(max(score, 0), 100)
    except Exception:
        return 0.0


async def generate_dashboard_insight(metrics: dict) -> dict:
    """
    Module 2: Dashboard AI Summary
    Returns: { insight_text }
    """
    prompt = f"""You are an AI operations analyst. Summarize the current platform health based on these metrics and suggest 2-3 action items.

Platform Metrics:
- Active Services: {metrics.get('active_services', 0)}
- Average Latency: {metrics.get('avg_latency_ms', 0):.1f} ms
- Error Rate: {metrics.get('error_rate_pct', 0):.1f}%
- Average Quality Score: {metrics.get('avg_quality_score', 0):.1f}%
- Drift Alerts: {metrics.get('drift_alert_count', 0)}

Provide a concise summary (3-4 sentences) followed by action items.

Format as:
SUMMARY:
[your summary]

ACTION ITEMS:
1. [item 1]
2. [item 2]
3. [item 3]"""

    try:
        response, _ = _make_api_call(
            caller="generate_dashboard_insight",
            model=settings.llm_model,
            max_tokens=settings.llm_max_tokens,
            messages=[{"role": "user", "content": prompt}],
        )
        text = response.content[0].text if response.content else ""
        return {"insight_text": text}
    except Exception as e:
        return {"insight_text": f"Error generating insight: {str(e)}"}


async def generate_compliance_summary(
    audit_data: list, incidents_data: list, drift_data: list
) -> dict:
    """
    Module 4: Compliance AI Report
    Returns: { report_text }
    """
    audit_summary = json.dumps(audit_data[:20], default=str) if audit_data else "No audit logs."
    incidents_summary = json.dumps(incidents_data[:10], default=str) if incidents_data else "No incidents."
    drift_summary = json.dumps(drift_data[:10], default=str) if drift_data else "No drift events."

    prompt = f"""You are an AI governance compliance officer. Generate a concise compliance report based on the following data from the AI operations platform.

AUDIT LOG ENTRIES (recent):
{audit_summary}

INCIDENTS (recent):
{incidents_summary}

DRIFT EVENTS (recent):
{drift_summary}

Write a professional compliance report with these sections:
1. Executive Summary (2-3 sentences)
2. Key Findings (bullet points)
3. Risk Assessment (any concerns)
4. Recommendations (actionable items)

Keep the report under 500 words."""

    try:
        response, _ = _make_api_call(
            caller="generate_compliance_summary",
            model=settings.llm_model,
            max_tokens=settings.llm_max_tokens,
            messages=[{"role": "user", "content": prompt}],
        )
        text = response.content[0].text if response.content else ""
        return {"report_text": text}
    except Exception as e:
        return {"report_text": f"Error generating compliance report: {str(e)}"}
