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
from datetime import datetime, timezone

from sqlalchemy.orm import Session

from app.config import get_settings
from app.models import AIService, Alert, EvalRun, EvalResult, EvalTestCase, Telemetry
from app.services.llm_client import run_eval_prompt, score_factuality, detect_hallucination

settings = get_settings()


def _compute_trend(scores: list[float]) -> str:
    if len(scores) < 2:
        return "stable"
    mid = len(scores) // 2
    first_half = sum(scores[:mid]) / mid
    second_half = sum(scores[mid:]) / len(scores[mid:])
    diff = second_half - first_half
    if diff > 3.0:
        return "improving"
    if diff < -3.0:
        return "declining"
    return "stable"


async def run_service_evaluation(
    db: Session,
    service: AIService,
    run_type: str = "manual",
) -> tuple[EvalRun, list[dict], bool]:
    """
    Run every test case for `service`, persist the EvalRun + children, and
    return (eval_run, per_test_results, drift_flagged).

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
        llm_result = await run_eval_prompt(prompt=tc.prompt)
        response_text = llm_result.get("response_text", "")
        latency_ms = llm_result.get("latency_ms", 0)

        halluc_score = None
        judge_refused = False
        score = 0.0

        if tc.category == "factuality":
            fact_score = await score_factuality(tc.expected_output, response_text)
            if fact_score is None:
                judge_refused = True
            else:
                score = fact_score
                factuality_scores.append(fact_score)
            halluc_score = await detect_hallucination(tc.prompt, response_text)
            if halluc_score is not None:
                hallucination_scores.append(halluc_score)
        elif tc.category == "format_json":
            try:
                json.loads(response_text)
                score = 100.0
            except (json.JSONDecodeError, TypeError):
                score = 0.0
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
            trend = _compute_trend(prev_scores + [quality_score])
            if trend == "declining" and quality_score < settings.drift_threshold + 10:
                drift_flagged = True
    else:
        drift_flagged = False

    eval_run = EvalRun(
        service_id=service.id,
        quality_score=quality_score,
        factuality_score=factuality_score,
        hallucination_score=hallucination_score,
        format_score=format_score,
        drift_flagged=drift_flagged,
        run_type=run_type,
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
