"""
Evaluations router for Module 2: evaluation harness, test case management, and drift detection.
"""

import json
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy.orm import Session

from app.config import get_settings
from app.database import get_db
from app.middleware.audit import log_action
from app.middleware.auth import get_current_user
from app.middleware.rbac import require_role
from app.models import AIService, Alert, EvalTestCase, EvalRun, EvalResult, User
from app.services.drift_trend import compute_quality_trend
from app.services.env_filter import apply_env_filter
from app.services.eval_runner import run_service_evaluation
from app.services.sensitivity import enforce_sensitivity

router = APIRouter()
settings = get_settings()


# ── Schemas ──

class EvalTestCaseCreate(BaseModel):
    service_id: int
    prompt: str = Field(..., max_length=10000)
    expected_output: str = Field(..., max_length=10000)
    category: str  # "factuality" or "format_json"


class EvalTestCaseResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    service_id: int
    prompt: str
    expected_output: str
    category: str
    created_at: datetime | None = None


class EvalRunResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    service_id: int
    service_name: str = ""
    quality_score: float
    factuality_score: float | None = None
    format_score: float | None = None
    hallucination_score: float | None = None
    drift_flagged: bool
    run_type: str
    run_status: str = "complete"
    judge_model: str | None = None
    run_at: datetime | None = None
    created_at: datetime | None = None


class EvalRunDetailResponse(EvalRunResponse):
    results: list[dict] = []


class EvalConfigResponse(BaseModel):
    """Read-only runtime config the Evaluations UI needs to describe
    scoring rules to reviewers. Kept minimal — only fields that the UI
    actively renders."""
    drift_threshold: float


# ── Evaluation Config ──

@router.get("/config", response_model=EvalConfigResponse)
def get_eval_config(_: User = Depends(get_current_user)) -> EvalConfigResponse:
    """
    Expose the active drift_threshold so the Score-details modal can
    quote the number that's really in force instead of hard-coding 75.
    Before this endpoint existed, changing DRIFT_THRESHOLD in .env would
    silently desync the backend math from the UI explainer.
    """
    return EvalConfigResponse(drift_threshold=settings.drift_threshold)


# ── Drift Analysis Helpers ──
#
# The quality-scores trend classifier (improving / declining / stable)
# now lives in `app.services.drift_trend.compute_quality_trend` so
# eval_runner and this router share one implementation. The
# `_compute_variance` helper below stays local — it's only used by
# the drift-check endpoint.


def _compute_variance(scores: list[float]) -> float:
    """Compute variance of scores."""
    if len(scores) < 2:
        return 0.0
    mean = sum(scores) / len(scores)
    return round(sum((s - mean) ** 2 for s in scores) / len(scores), 2)


# ── Test Case CRUD ──

@router.post(
    "/test-cases",
    response_model=EvalTestCaseResponse,
    dependencies=[Depends(require_role(["admin", "maintainer"]))],
)
def create_test_case(
    req: EvalTestCaseCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    service = db.query(AIService).filter(AIService.id == req.service_id).first()
    if not service:
        raise HTTPException(status_code=404, detail="Service not found")

    if req.category not in ("factuality", "format_json"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Category must be 'factuality' or 'format_json'",
        )

    test_case = EvalTestCase(
        service_id=req.service_id,
        prompt=req.prompt,
        expected_output=req.expected_output,
        category=req.category,
    )
    db.add(test_case)
    db.commit()
    db.refresh(test_case)

    log_action(
        db, current_user.id, "create_test_case", "eval_test_cases",
        test_case.id, new_value=json.dumps(req.model_dump()),
    )

    return test_case


@router.get("/test-cases", response_model=list[EvalTestCaseResponse])
def list_test_cases(
    service_id: int | None = Query(None),
    environment: str | None = Query(None),
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    query = db.query(EvalTestCase)
    if service_id is not None:
        query = query.filter(EvalTestCase.service_id == service_id)
    query = apply_env_filter(query, environment)
    return query.order_by(EvalTestCase.id.asc()).all()


@router.get("/test-cases/{case_id}", response_model=EvalTestCaseResponse)
def get_test_case(
    case_id: int,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    test_case = db.query(EvalTestCase).filter(EvalTestCase.id == case_id).first()
    if not test_case:
        raise HTTPException(status_code=404, detail="Test case not found")
    return test_case


@router.delete(
    "/test-cases/{case_id}",
    dependencies=[Depends(require_role(["admin", "maintainer"]))],
)
def delete_test_case(
    case_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    test_case = db.query(EvalTestCase).filter(EvalTestCase.id == case_id).first()
    if not test_case:
        raise HTTPException(status_code=404, detail="Test case not found")

    log_action(
        db, current_user.id, "delete_test_case", "eval_test_cases",
        test_case.id, old_value=test_case.prompt[:100],
    )

    db.delete(test_case)
    db.commit()
    return {"detail": "Test case deleted", "id": case_id}


# ── Evaluation Runs ──

@router.post(
    "/run/{service_id}",
    response_model=EvalRunDetailResponse,
    dependencies=[Depends(require_role(["admin", "maintainer"]))],
)
async def run_evaluation(
    service_id: int,
    allow_confidential: bool = Query(False, description="Admin override to run evals on confidential services"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    service = db.query(AIService).filter(AIService.id == service_id).first()
    if not service:
        raise HTTPException(status_code=404, detail="Service not found")

    # Gate confidential services — admin-only with explicit override
    enforce_sensitivity(db, service, current_user, allow_confidential=allow_confidential)

    if not db.query(EvalTestCase).filter(EvalTestCase.service_id == service_id).first():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No test cases found for this service. Create test cases first.",
        )

    # Delegate to the shared runner — persists EvalRun + EvalResults +
    # Telemetry + (if drift) Alert in one committed unit.
    eval_run, results, drift_flagged = await run_service_evaluation(
        db, service, run_type="manual", user_id=current_user.id,
    )

    log_action(
        db, current_user.id, "run_evaluation", "eval_runs",
        eval_run.id, new_value=f"quality={eval_run.quality_score}, drift={drift_flagged}",
    )

    # If the runner opened a drift alert, attribute it to this user in audit.
    if drift_flagged:
        alert = (
            db.query(Alert)
            .filter(Alert.service_id == service_id, Alert.alert_type == "drift")
            .order_by(Alert.id.desc())
            .first()
        )
        if alert:
            log_action(
                db, current_user.id, "alert_created", "alerts", alert.id,
                new_value=f"drift|{alert.severity}|service={service_id}|score={eval_run.quality_score}",
            )

    return EvalRunDetailResponse(
        id=eval_run.id,
        service_id=eval_run.service_id,
        service_name=service.name,
        quality_score=eval_run.quality_score,
        factuality_score=eval_run.factuality_score,
        format_score=eval_run.format_score,
        hallucination_score=eval_run.hallucination_score,
        drift_flagged=eval_run.drift_flagged,
        run_type=eval_run.run_type,
        run_status=eval_run.run_status,
        judge_model=eval_run.judge_model,
        run_at=eval_run.run_at,
        created_at=eval_run.created_at,
        results=results,
    )


@router.get("/runs", response_model=list[EvalRunResponse])
def list_eval_runs(
    service_id: int | None = Query(None),
    environment: str | None = Query(None),
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    query = db.query(EvalRun)
    if service_id is not None:
        query = query.filter(EvalRun.service_id == service_id)
    query = apply_env_filter(query, environment)
    runs = query.order_by(EvalRun.run_at.desc()).limit(50).all()

    # Batch-load services in one query instead of N+1 lookups in the loop.
    service_ids = {run.service_id for run in runs}
    services_by_id = {
        s.id: s for s in (
            db.query(AIService).filter(AIService.id.in_(service_ids)).all()
            if service_ids else []
        )
    }

    result = []
    for run in runs:
        service = services_by_id.get(run.service_id)
        result.append(EvalRunResponse(
            id=run.id,
            service_id=run.service_id,
            service_name=service.name if service else "",
            quality_score=run.quality_score,
            factuality_score=run.factuality_score,
            format_score=run.format_score,
            hallucination_score=run.hallucination_score,
            drift_flagged=run.drift_flagged,
            run_type=run.run_type,
            run_status=run.run_status,
            judge_model=run.judge_model,
            run_at=run.run_at,
            created_at=run.created_at,
        ))
    return result


@router.get("/runs/{run_id}", response_model=EvalRunResponse)
def get_eval_run(
    run_id: int,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    run = db.query(EvalRun).filter(EvalRun.id == run_id).first()
    if not run:
        raise HTTPException(status_code=404, detail="Eval run not found")

    service = db.query(AIService).filter(AIService.id == run.service_id).first()
    return EvalRunResponse(
        id=run.id,
        service_id=run.service_id,
        service_name=service.name if service else "",
        quality_score=run.quality_score,
        factuality_score=run.factuality_score,
        format_score=run.format_score,
        hallucination_score=run.hallucination_score,
        drift_flagged=run.drift_flagged,
        run_type=run.run_type,
        run_status=run.run_status,
        judge_model=run.judge_model,
        run_at=run.run_at,
        created_at=run.created_at,
    )


@router.get("/cost-preview/{service_id}")
def eval_cost_preview(
    service_id: int,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    """Preview the estimated cost and API calls before running an evaluation.

    Pricing is looked up per-service-model via `model_catalog.pricing_for`
    so a Haiku-backed service gets Haiku's $1/$5 rates (not Sonnet's
    $3/$15 as was hardcoded previously). Unknown models fall back to
    Sonnet rates — same safe over-estimate rule the runtime cost
    estimator in llm_client._estimate_cost uses.
    """
    service = db.query(AIService).filter(AIService.id == service_id).first()

    test_cases = (
        db.query(EvalTestCase)
        .filter(EvalTestCase.service_id == service_id)
        .all()
    )
    if not test_cases:
        return {"service_id": service_id, "test_cases": 0, "api_calls": 0, "estimated_cost_usd": 0}

    factuality_count = sum(1 for tc in test_cases if tc.category == "factuality")
    format_count = sum(1 for tc in test_cases if tc.category == "format_json")
    api_calls = len(test_cases) + factuality_count

    est_input_tokens = api_calls * 500
    est_output_tokens = api_calls * 200

    from app.services.model_catalog import pricing_for
    input_rate, output_rate = pricing_for(service.model_name if service else "")
    est_cost = round(
        (est_input_tokens / 1_000_000) * input_rate
        + (est_output_tokens / 1_000_000) * output_rate,
        6,
    )

    return {
        "service_id": service_id,
        "test_cases": len(test_cases),
        "factuality_cases": factuality_count,
        "format_cases": format_count,
        "api_calls": api_calls,
        "estimated_input_tokens": est_input_tokens,
        "estimated_output_tokens": est_output_tokens,
        "estimated_cost_usd": est_cost,
        "daily_budget_usd": settings.api_daily_budget,
        "rate_limit_per_min": settings.api_max_calls_per_minute,
    }


# ── Advanced Drift Detection ──

@router.get("/drift-check/{service_id}")
def drift_check(
    service_id: int,
    window: int = Query(5, ge=2, le=20, description="Number of recent runs to analyze"),
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    """Enhanced drift check with severity, trend analysis, and per-test-case breakdown."""
    runs = (
        db.query(EvalRun)
        .filter(EvalRun.service_id == service_id)
        .order_by(EvalRun.run_at.desc())
        .limit(window)
        .all()
    )

    if not runs:
        return {
            "service_id": service_id,
            "drift_detected": False,
            "drift_severity": "none",
            "current_score": None,
            "previous_score": None,
            "threshold": settings.drift_threshold,
            "trend_direction": "stable",
            "trend_scores": [],
            "trend_run_dates": [],
            "per_test_case_breakdown": [],
            "confidence": "low",
            "avg_last_n": None,
            "score_variance": None,
            "message": "No evaluation runs found",
        }

    current = runs[0]
    previous = runs[1] if len(runs) > 1 else None

    # Scores in chronological order (oldest first)
    scores = [r.quality_score for r in reversed(runs)]
    run_dates = [r.run_at.isoformat() if r.run_at else "" for r in reversed(runs)]

    avg = sum(scores) / len(scores)
    variance = _compute_variance(scores)
    trend = compute_quality_trend(scores)

    # Confidence based on number of runs
    confidence = "low" if len(runs) <= 2 else ("medium" if len(runs) <= 4 else "high")

    # Drift severity
    score = current.quality_score
    if score < settings.drift_threshold:
        severity = "critical"
    elif (score < settings.drift_threshold + 10) or trend == "declining":
        severity = "warning"
    else:
        severity = "none"

    # Sudden drop detection: current score vs average of previous runs
    if previous and len(scores) >= 3:
        prev_avg = sum(scores[:-1]) / (len(scores) - 1)
        if score < prev_avg - 15:
            severity = "critical"

    # Per-test-case breakdown (from EvalResult) — batched to avoid N+1.
    latest_results = (
        db.query(EvalResult)
        .filter(EvalResult.eval_run_id == current.id)
        .all()
    )

    # 1 query for all test cases referenced by the current run (replaces
    # one-query-per-EvalResult inside the loop).
    tc_ids = {er.test_case_id for er in latest_results}
    test_cases_by_id = {
        tc.id: tc for tc in (
            db.query(EvalTestCase).filter(EvalTestCase.id.in_(tc_ids)).all()
            if tc_ids else []
        )
    }

    # 1 query for ALL historical scores covering those test_case_ids,
    # ordered newest-first. Group by test_case_id in Python and truncate
    # each group to `window` entries. Replaces N queries (one per
    # EvalResult) with a single bulk join.
    historical_by_tc: dict[int, list[float]] = {}
    if tc_ids:
        historical_rows = (
            db.query(EvalResult.test_case_id, EvalResult.score)
            .filter(EvalResult.test_case_id.in_(tc_ids))
            .join(EvalRun)
            .order_by(EvalRun.run_at.desc())
            .all()
        )
        for tc_id, score in historical_rows:
            bucket = historical_by_tc.setdefault(tc_id, [])
            if len(bucket) < window:
                bucket.append(score)

    per_test = []
    for er in latest_results:
        tc = test_cases_by_id.get(er.test_case_id)
        # Historical scores are stored newest-first above; reverse for
        # chronological order so compute_quality_trend gets oldest→newest.
        hist_scores = list(reversed(historical_by_tc.get(er.test_case_id, [])))
        per_test.append({
            "test_case_id": er.test_case_id,
            "prompt_snippet": (tc.prompt[:60] + "...") if tc and len(tc.prompt) > 60 else (tc.prompt if tc else ""),
            "category": tc.category if tc else "",
            "current_score": er.score,
            "avg_score": round(sum(hist_scores) / len(hist_scores), 1) if hist_scores else er.score,
            "trend": compute_quality_trend(hist_scores) if len(hist_scores) >= 2 else "stable",
        })

    return {
        "service_id": service_id,
        "drift_detected": severity != "none",
        "drift_severity": severity,
        "current_score": current.quality_score,
        "previous_score": previous.quality_score if previous else None,
        "threshold": settings.drift_threshold,
        "trend_direction": trend,
        "trend_scores": scores,
        "trend_run_dates": run_dates,
        "per_test_case_breakdown": per_test,
        "confidence": confidence,
        "avg_last_n": round(avg, 1),
        "score_variance": variance,
        "message": f"Drift severity: {severity}. Trend: {trend}. Based on {len(runs)} runs.",
    }


@router.get("/drift-trend/{service_id}")
def drift_trend(
    service_id: int,
    limit: int = Query(10, ge=2, le=50),
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    """Return quality score history for charting drift over time."""
    runs = (
        db.query(EvalRun)
        .filter(EvalRun.service_id == service_id)
        .order_by(EvalRun.run_at.asc())
        .limit(limit)
        .all()
    )
    return [
        {
            "run_id": r.id,
            "run_at": r.run_at.isoformat() if r.run_at else "",
            "quality_score": r.quality_score,
            "factuality_score": r.factuality_score,
            "format_score": r.format_score,
            "drift_flagged": r.drift_flagged,
        }
        for r in runs
    ]
