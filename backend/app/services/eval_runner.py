"""
Core evaluation logic — shared between the manual POST /evaluations/run/{id}
endpoint and the APScheduler-driven automated eval job.

Keeps one implementation of:
  LLM call -> score -> aggregate -> drift gate -> persist EvalRun +
  EvalResults + Telemetry + (if drift) Alert.

Callers differ on how they treat "who ran this" (user vs. system), so this
module stays agnostic of the user/audit layer; audit logging lives in the
calling site when there's a user to attribute to.
"""

import json
import re
from datetime import datetime, timezone

from sqlalchemy.orm import Session

from app.config import get_settings
from app.models import AIService, Alert, EvalRun, EvalResult, EvalTestCase, Telemetry
from app.services.drift_trend import compute_quality_trend
from app.services.llm_client import run_eval_prompt, judge_response

settings = get_settings()


_JSON_FENCE_RE = re.compile(r"```(?:json)?\s*(\{.*?\}|\[.*?\])\s*```", re.DOTALL)
_JSON_OBJECT_RE = re.compile(r"(\{.*\}|\[.*\])", re.DOTALL)


def _score_json_payload(text: str) -> float:
    """Return 100 if `text` contains a well-formed JSON object/array, else 0.

    Tries, in order: raw parse, fenced ```json``` block, first {...}/[...] span.
    """
    if not text:
        return 0.0
    candidates = [text]
    fence = _JSON_FENCE_RE.search(text)
    if fence:
        candidates.append(fence.group(1))
    span = _JSON_OBJECT_RE.search(text)
    if span:
        candidates.append(span.group(1))
    for candidate in candidates:
        try:
            json.loads(candidate)
            return 100.0
        except (json.JSONDecodeError, TypeError):
            continue
    return 0.0


async def run_service_evaluation(
    db: Session,
    service: AIService,
    run_type: str = "manual",
    user_id: int | None = None,
) -> tuple[EvalRun, list[dict], bool]:
    """
    Run every test case for `service`, persist the EvalRun + children, and
    return (eval_run, per_test_results, drift_flagged).

    `user_id` is the authenticated user who triggered the run (manual)
    or None when the background scheduler is the origin. Forwarded to
    every Claude call so the usage log attributes spend correctly and
    per-user rate limits can fire.

    Raises ValueError if the service has no test cases.
    """
    test_cases = (
        db.query(EvalTestCase)
        .filter(EvalTestCase.service_id == service.id)
        .all()
    )
    if not test_cases:
        raise ValueError(f"No test cases for service {service.id}")

    results: list[dict] = []
    factuality_scores: list[float] = []
    format_scores: list[float] = []
    hallucination_scores: list[float] = []

    for tc in test_cases:
        llm_result = await run_eval_prompt(
            prompt=tc.prompt,
            user_id=user_id,
            service_id=service.id,
        )
        response_text = llm_result.get("response_text", "")
        latency_ms = llm_result.get("latency_ms", 0)

        halluc_score = None
        judge_refused = False
        score = 0.0

        if tc.category == "factuality":
            if response_text.startswith("ERROR:"):
                # Short-circuit 1 — actor errored. Skip the judge entirely:
                # score=0.0 default stands, halluc_score stays None, and
                # the status transition below marks this row "error",
                # which is excluded from valid_scores aggregation. The
                # `pass` is load-bearing — without it the elif collapses
                # into an if and ERROR: responses would waste a Claude
                # round-trip on the judge.
                pass
            elif response_text.strip() == (tc.expected_output or "").strip():
                # Short-circuit 2 — exact match. A judge call here would
                # just confirm 100 and waste a Claude round-trip. Compare
                # on stripped text so trailing whitespace doesn't demote
                # a perfect answer.
                score = 100.0
                factuality_scores.append(100.0)
                halluc_score = 0.0
                hallucination_scores.append(0.0)

            # Normal path: one merged judge call returns both scores.
            else:
                judged = await judge_response(
                    tc.prompt,
                    tc.expected_output,
                    response_text,
                    user_id=user_id,
                    service_id=service.id,
                )
                fact = judged["factuality"]
                halluc = judged["hallucination"]
                if fact is None:
                    judge_refused = True
                else:
                    score = fact
                    factuality_scores.append(fact)
                if halluc is not None:
                    halluc_score = halluc
                    hallucination_scores.append(halluc)
        elif tc.category == "format_json":
            # Claude often wraps JSON in ```json fences or adds prose around it.
            # Extract the JSON payload before validating so a well-formed object
            # inside markdown still scores 100.
            score = _score_json_payload(response_text)
            format_scores.append(score)

        if judge_refused:
            result_status = "judge_refused"
            display_score = None
        elif response_text.startswith("ERROR:"):
            result_status = "error"
            display_score = score
        else:
            result_status = "success"
            display_score = score

        results.append({
            "test_case_id": tc.id,
            "category": tc.category,
            "prompt": tc.prompt[:100],
            "expected": tc.expected_output[:100],
            "actual": response_text[:200],
            "score": display_score if display_score is not None else 0,
            "hallucination_score": halluc_score,
            "latency_ms": latency_ms,
            "status": result_status,
        })

    # Aggregate — exclude both judge_refused AND infra "error" rows so a
    # flaky judge or a Claude 404 doesn't fraudulently inflate drift.
    valid_scores = [r["score"] for r in results if r["status"] not in ("judge_refused", "error")]
    quality_score = round(sum(valid_scores) / len(valid_scores), 1) if valid_scores else 0
    factuality_score = (
        round(sum(factuality_scores) / len(factuality_scores), 1)
        if factuality_scores else None
    )
    format_score = (
        round(sum(format_scores) / len(format_scores), 1)
        if format_scores else None
    )
    hallucination_score = (
        round(sum(hallucination_scores) / len(hallucination_scores), 1)
        if hallucination_scores else None
    )

    if valid_scores:
        drift_flagged = quality_score < settings.drift_threshold
        recent = (
            db.query(EvalRun)
            .filter(EvalRun.service_id == service.id)
            .order_by(EvalRun.run_at.desc())
            .limit(4)
            .all()
        )
        if len(recent) >= 3:
            prev_scores = [r.quality_score for r in reversed(recent)]
            trend = compute_quality_trend(prev_scores + [quality_score])
            if trend == "declining" and quality_score < settings.drift_threshold + 10:
                drift_flagged = True
    else:
        drift_flagged = False

    # Explicit completeness state so the UI doesn't have to infer "0% but
    # Healthy" from the shape of the data. An incomplete run means every test
    # either errored or the judge refused — quality_score=0 is math, not
    # signal.
    run_status = "complete" if valid_scores else "incomplete"

    eval_run = EvalRun(
        service_id=service.id,
        quality_score=quality_score,
        factuality_score=factuality_score,
        hallucination_score=hallucination_score,
        format_score=format_score,
        drift_flagged=drift_flagged,
        run_type=run_type,
        run_status=run_status,
        judge_model=settings.judge_model,
    )
    db.add(eval_run)
    db.flush()  # get eval_run.id for child FKs

    for r in results:
        db.add(EvalResult(
            eval_run_id=eval_run.id,
            test_case_id=r["test_case_id"],
            response_text=r["actual"],
            score=r["score"],
            latency_ms=r["latency_ms"],
            status=r["status"],
        ))

    now = datetime.now(timezone.utc)
    db.add(Telemetry(
        service_id=service.id, metric_name="quality_score",
        metric_value=quality_score, recorded_at=now,
    ))
    if factuality_score is not None:
        db.add(Telemetry(
            service_id=service.id, metric_name="factuality_score",
            metric_value=factuality_score, recorded_at=now,
        ))
    if format_score is not None:
        db.add(Telemetry(
            service_id=service.id, metric_name="format_score",
            metric_value=format_score, recorded_at=now,
        ))

    if drift_flagged:
        severity = "critical" if quality_score < settings.drift_threshold else "warning"
        db.add(Alert(
            alert_type="drift",
            severity=severity,
            message=f"{service.name} quality dropped to {quality_score}% (threshold: {settings.drift_threshold}%)",
            service_id=service.id,
        ))

    db.commit()
    db.refresh(eval_run)

    return eval_run, results, drift_flagged
