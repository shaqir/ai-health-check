"""
Dashboard router for Module 2: metrics aggregation, trends, and AI-powered insights.
"""

from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.config import get_settings
from app.database import get_db
from app.middleware.auth import get_current_user
from app.middleware.rbac import require_role
from app.models import AIService, AILlmDraft, Alert, APIUsageLog, ConnectionLog, EvalRun, Environment, Telemetry, User
from app.services.draft_service import approve_draft, create_draft
from app.services.env_filter import apply_env_filter as _env_filter
from app.services.llm_client import generate_dashboard_insight

router = APIRouter()
settings = get_settings()


# ── Schemas ──

class DashboardMetrics(BaseModel):
    active_services: int
    avg_latency_ms: float
    p50_latency_ms: float
    p95_latency_ms: float
    p99_latency_ms: float
    error_rate_pct: float
    avg_quality_score: float
    latency_trend: str  # "up", "down", "neutral"
    error_trend: str
    quality_trend: str


# ── Helpers ──

def _compute_trend(
    current: float,
    previous: float,
    n_current: int | None = None,
    n_previous: int | None = None,
    min_samples: int = 3,
) -> str:
    # Fall back to neutral when either side has too few samples. A 2-vs-2
    # comparison is noisy enough that one outlier flips the verdict, so
    # we refuse to draw an arrow until each window has at least min_samples.
    if n_current is not None and n_current < min_samples:
        return "neutral"
    if n_previous is not None and n_previous < min_samples:
        return "neutral"
    if previous == 0:
        return "neutral"
    diff = ((current - previous) / previous) * 100
    if diff > 5:
        return "up"
    elif diff < -5:
        return "down"
    return "neutral"


# ── Endpoints ──

@router.get("/metrics", response_model=DashboardMetrics)
def get_metrics(
    environment: str | None = Query(None),
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    now = datetime.now(timezone.utc)
    day_ago = now - timedelta(hours=24)
    two_days_ago = now - timedelta(hours=48)
    week_ago = now - timedelta(days=7)
    two_weeks_ago = now - timedelta(days=14)

    # Active services count (respects environment filter)
    svc_query = db.query(AIService).filter(AIService.is_active == True)
    if environment and environment not in ("all", ""):
        env_map = {"production": "prod", "staging": "staging", "dev": "dev"}
        env_val = env_map.get(environment, environment)
        try:
            svc_query = svc_query.filter(AIService.environment == Environment(env_val))
        except ValueError:
            pass
    active_services = svc_query.count()

    # Latency (last 24h) — pull env-filtered raw samples, compute stats in Python.
    latencies = sorted(
        l[0] for l in _env_filter(
            db.query(ConnectionLog.latency_ms).filter(
                ConnectionLog.tested_at >= day_ago,
                ConnectionLog.latency_ms != None,
            ),
            environment,
        ).all() if l[0] is not None
    )
    avg_latency = sum(latencies) / len(latencies) if latencies else 0
    p50 = latencies[len(latencies) // 2] if latencies else 0
    p95 = latencies[int(len(latencies) * 0.95)] if latencies else 0
    p99 = latencies[int(len(latencies) * 0.99)] if latencies else 0

    # Previous 24h latency for trend (env-filtered).
    prev_latencies = [
        l[0] for l in _env_filter(
            db.query(ConnectionLog.latency_ms).filter(
                ConnectionLog.tested_at >= two_days_ago,
                ConnectionLog.tested_at < day_ago,
                ConnectionLog.latency_ms != None,
            ),
            environment,
        ).all() if l[0] is not None
    ]
    prev_latency = sum(prev_latencies) / len(prev_latencies) if prev_latencies else 0

    # "Error rate" here is the DRIFT RATE — percentage of eval runs in the last
    # 7 days flagged for drift. This is quality error (bad model output), NOT
    # infra error (HTTP failures, timeouts). Infra failures live in ConnectionLog.
    #
    # Incomplete runs are EXCLUDED from both the numerator and denominator.
    # An "incomplete" run produced no measurable score (every test errored or
    # the judge refused), so counting it as either clean or drift would skew
    # the metric in a way the Panel would rightly call out.
    recent_run_total = _env_filter(
        db.query(EvalRun).filter(
            EvalRun.run_at >= week_ago,
            EvalRun.run_status == "complete",
        ),
        environment,
    ).count()
    recent_run_flagged = _env_filter(
        db.query(EvalRun).filter(
            EvalRun.run_at >= week_ago,
            EvalRun.run_status == "complete",
            EvalRun.drift_flagged == True,
        ),
        environment,
    ).count()
    error_rate = (recent_run_flagged / recent_run_total * 100) if recent_run_total > 0 else 0

    # Previous week drift rate for trend.
    prev_run_total = _env_filter(
        db.query(EvalRun).filter(
            EvalRun.run_at >= two_weeks_ago,
            EvalRun.run_at < week_ago,
            EvalRun.run_status == "complete",
        ),
        environment,
    ).count()
    prev_run_flagged = _env_filter(
        db.query(EvalRun).filter(
            EvalRun.run_at >= two_weeks_ago,
            EvalRun.run_at < week_ago,
            EvalRun.run_status == "complete",
            EvalRun.drift_flagged == True,
        ),
        environment,
    ).count()
    prev_error_rate = (prev_run_flagged / prev_run_total * 100) if prev_run_total > 0 else 0

    # Avg quality score (last 10 env-filtered runs). Exclude incomplete runs
    # — their quality_score=0 is math, not signal, and would drag the average
    # to a value that doesn't reflect actual model health.
    recent_runs = (
        _env_filter(db.query(EvalRun), environment)
        .filter(EvalRun.run_status == "complete")
        .order_by(EvalRun.run_at.desc())
        .limit(10)
        .all()
    )
    avg_quality = (
        sum(r.quality_score for r in recent_runs) / len(recent_runs)
        if recent_runs else 0
    )

    # Previous 10 runs for quality trend.
    older_runs = (
        _env_filter(db.query(EvalRun), environment)
        .filter(EvalRun.run_status == "complete")
        .order_by(EvalRun.run_at.desc())
        .offset(10)
        .limit(10)
        .all()
    )
    prev_quality = (
        sum(r.quality_score for r in older_runs) / len(older_runs)
        if older_runs else 0
    )

    return DashboardMetrics(
        active_services=active_services,
        avg_latency_ms=round(avg_latency, 1),
        p50_latency_ms=round(p50, 1),
        p95_latency_ms=round(p95, 1),
        p99_latency_ms=round(p99, 1),
        error_rate_pct=round(error_rate, 1),
        avg_quality_score=round(avg_quality, 1),
        latency_trend=_compute_trend(
            avg_latency, prev_latency,
            n_current=len(latencies), n_previous=len(prev_latencies),
        ),
        error_trend=_compute_trend(
            error_rate, prev_error_rate,
            n_current=recent_run_total, n_previous=prev_run_total,
        ),
        quality_trend=_compute_trend(
            avg_quality, prev_quality,
            n_current=len(recent_runs), n_previous=len(older_runs),
        ),
    )


@router.get("/latency-trend")
def get_latency_trend(
    environment: str | None = Query(None),
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    now = datetime.now(timezone.utc)
    day_ago = now - timedelta(hours=24)

    logs = (
        _env_filter(
            db.query(ConnectionLog).filter(ConnectionLog.tested_at >= day_ago),
            environment,
        )
        .order_by(ConnectionLog.tested_at.asc())
        .all()
    )

    # Group into 4-hour buckets
    buckets = {}
    for log in logs:
        hour = (log.tested_at.hour // 4) * 4
        label = f"{hour:02d}:00"
        if label not in buckets:
            buckets[label] = []
        buckets[label].append(log.latency_ms or 0)

    result = []
    for hour in range(0, 24, 4):
        label = f"{hour:02d}:00"
        values = buckets.get(label, [])
        avg_ms = round(sum(values) / len(values), 1) if values else 0
        result.append({"time": label, "ms": avg_ms})

    return result


@router.get("/quality-trend")
def get_quality_trend(
    environment: str | None = Query(None),
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    runs = (
        _env_filter(db.query(EvalRun), environment)
        .order_by(EvalRun.run_at.asc())
        .limit(6)
        .all()
    )

    return [
        {"run": f"Run {i + 1}", "score": round(run.quality_score, 1)}
        for i, run in enumerate(runs)
    ]


@router.get("/error-trend")
def get_error_trend(
    environment: str | None = Query(None),
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    # Drift rate per day of week over the last 7 days — quality error, not
    # infra. Matches the /metrics "error_rate_pct" semantic.
    now = datetime.now(timezone.utc)
    week_ago = now - timedelta(days=7)

    runs = _env_filter(
        db.query(EvalRun).filter(EvalRun.run_at >= week_ago),
        environment,
    ).all()

    day_names = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
    daily_totals = {}
    daily_flagged = {}

    for run in runs:
        day_name = day_names[run.run_at.weekday()]
        daily_totals[day_name] = daily_totals.get(day_name, 0) + 1
        if run.drift_flagged:
            daily_flagged[day_name] = daily_flagged.get(day_name, 0) + 1

    result = []
    for day in day_names:
        total = daily_totals.get(day, 0)
        flagged = daily_flagged.get(day, 0)
        rate = round((flagged / total * 100), 1) if total > 0 else 0
        result.append({"time": day, "rate": rate})

    return result


@router.get("/recent-evals")
def get_recent_evals(
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    runs = (
        db.query(EvalRun)
        .order_by(EvalRun.run_at.desc())
        .limit(10)
        .all()
    )

    result = []
    for run in runs:
        service = db.query(AIService).filter(AIService.id == run.service_id).first()
        result.append({
            "id": run.id,
            # Emit ISO-8601 with explicit UTC so the client can render in the
            # viewer's local timezone. SQLite drops tzinfo on write, so we
            # re-attach UTC here — every write path uses utcnow() by convention.
            "timestamp": run.run_at.replace(tzinfo=timezone.utc).isoformat() if run.run_at else "",
            "score": run.quality_score,
            "drift": run.drift_flagged,
            "run_status": run.run_status,
            "type": run.run_type.capitalize(),
            "service_name": service.name if service else "",
        })

    return result


@router.get("/drift-alerts")
def get_drift_alerts(
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    now = datetime.now(timezone.utc)
    week_ago = now - timedelta(days=7)

    runs = (
        db.query(EvalRun)
        .filter(EvalRun.drift_flagged == True, EvalRun.run_at >= week_ago)
        .order_by(EvalRun.run_at.desc())
        .all()
    )

    result = []
    for run in runs:
        service = db.query(AIService).filter(AIService.id == run.service_id).first()
        result.append({
            "service_name": service.name if service else "",
            "score": run.quality_score,
            "threshold": settings.drift_threshold,
            "run_id": run.id,
            "run_at": run.run_at.replace(tzinfo=timezone.utc).isoformat() if run.run_at else "",
        })

    return result


@router.post(
    "/ai-summary",
    dependencies=[Depends(require_role(["admin", "maintainer"]))],
)
async def get_ai_summary(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    now = datetime.now(timezone.utc)
    day_ago = now - timedelta(hours=24)
    week_ago = now - timedelta(days=7)

    active_services = db.query(AIService).filter(AIService.is_active == True).count()

    avg_latency = db.query(func.avg(ConnectionLog.latency_ms)).filter(
        ConnectionLog.tested_at >= day_ago
    ).scalar() or 0

    total_conn = db.query(ConnectionLog).filter(ConnectionLog.tested_at >= week_ago).count()
    failed_conn = db.query(ConnectionLog).filter(
        ConnectionLog.tested_at >= week_ago, ConnectionLog.status == "failure"
    ).count()
    error_rate = (failed_conn / total_conn * 100) if total_conn > 0 else 0

    recent_runs = db.query(EvalRun).order_by(EvalRun.run_at.desc()).limit(10).all()
    avg_quality = (
        sum(r.quality_score for r in recent_runs) / len(recent_runs)
        if recent_runs else 0
    )

    drift_count = db.query(EvalRun).filter(
        EvalRun.drift_flagged == True, EvalRun.run_at >= week_ago
    ).count()

    metrics = {
        "active_services": active_services,
        "avg_latency_ms": avg_latency,
        "error_rate_pct": error_rate,
        "avg_quality_score": avg_quality,
        "drift_alert_count": drift_count,
    }

    result = await generate_dashboard_insight(metrics, user_id=current_user.id)

    # HITL: persist as unapproved draft. Caller must explicitly approve
    # before the insight counts as an official published update.
    draft = create_draft(
        db,
        surface="dashboard_insight",
        content=result.get("insight_text", ""),
        generated_by_user_id=current_user.id,
        surface_ref=now.strftime("%Y-%m-%d"),
    )

    return {
        "draft_id": draft.id,
        "content": draft.content,
        "approved": False,
        "surface": "dashboard_insight",
    }


@router.post(
    "/ai-summary/{draft_id}/approve",
    dependencies=[Depends(require_role(["admin", "maintainer"]))],
)
def approve_ai_summary(
    draft_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    draft = approve_draft(db, draft_id, current_user.id)
    return {
        "draft_id": draft.id,
        "approved": True,
        "approved_by_user_id": draft.approved_by_user_id,
        "approved_at": draft.approved_at,
    }


@router.get("/ai-summary/recent")
def recent_ai_summaries(
    approved_only: bool = Query(True),
    limit: int = Query(10, ge=1, le=50),
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    q = db.query(AILlmDraft).filter(AILlmDraft.surface == "dashboard_insight")
    if approved_only:
        q = q.filter(AILlmDraft.approved_by_user_id.isnot(None))
    rows = q.order_by(AILlmDraft.id.desc()).limit(limit).all()
    return [
        {
            "draft_id": r.id,
            "content": r.content,
            "approved": r.approved_by_user_id is not None,
            "approved_at": r.approved_at,
            "created_at": r.created_at,
            "surface_ref": r.surface_ref,
        }
        for r in rows
    ]


@router.get("/claude-health")
async def claude_api_health(
    _: User = Depends(get_current_user),
):
    """Lightweight health check for the Claude API — verifies connectivity and latency."""
    from app.services.llm_client import test_connection
    result = await test_connection(prompt="Hi", model=settings.llm_model)
    return {
        "api_status": result["status"],
        "latency_ms": result["latency_ms"],
        "model": settings.llm_model,
        "response_snippet": result["response_snippet"][:50],
    }


@router.get("/settings")
def get_platform_settings(
    _: User = Depends(get_current_user),
):
    """
    Return non-sensitive platform configuration for the settings page.

    Dual-model shape: the system runs an actor (Sonnet-family, handles the
    service under test + synthesis tasks) and a judge (Haiku-family, scores
    factuality + hallucination via one merged-rubric call). Pricing differs
    per model, so the UI needs both rows, not a flat single model.

    The source of truth for pricing lives in app.services.model_catalog —
    we read it here (via pricing_for, which normalizes date-suffixed ids)
    so the page can never drift from what the cost estimator is actually
    charging against the budget, even if the env sets a dated model id.
    """
    from app.services.model_catalog import pricing_for

    def _model_entry(role: str, model_id: str, purpose: str) -> dict:
        input_rate, output_rate = pricing_for(model_id)
        return {
            "role": role,
            "provider": "Anthropic",
            "id": model_id,
            "purpose": purpose,
            "pricing": {
                "input_per_million_usd": input_rate,
                "output_per_million_usd": output_rate,
                "currency": "USD",
            },
        }

    return {
        "models": {
            "actor": _model_entry(
                role="actor",
                model_id=settings.llm_model,
                purpose=(
                    "Generates the responses being evaluated plus synthesis "
                    "work: incident triage, dashboard insights, compliance "
                    "reports."
                ),
            ),
            "judge": _model_entry(
                role="judge",
                model_id=settings.judge_model,
                purpose=(
                    "Scores factuality + hallucination via one merged-rubric "
                    "JSON call. Different family from the actor — reduces "
                    "self-scoring correlation."
                ),
            ),
        },
        "runtime": {
            "max_tokens": settings.llm_max_tokens,
            "timeout_seconds": settings.llm_timeout_seconds,
        },
        "budget": {
            "daily_limit_usd": settings.api_daily_budget,
            "monthly_limit_usd": settings.api_monthly_budget,
            "rate_limit_per_min": settings.api_max_calls_per_minute,
        },
        "evaluation": {
            "drift_threshold_pct": settings.drift_threshold,
            "health_check_schedule_minutes": settings.health_check_schedule_minutes,
            "eval_schedule_minutes": settings.eval_schedule_minutes,
        },
    }


@router.get("/api-usage")
def get_api_usage(
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    now = datetime.now(timezone.utc)
    day_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
    month_start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)

    # Today's usage
    daily_stats = db.query(
        func.count(APIUsageLog.id),
        func.coalesce(func.sum(APIUsageLog.input_tokens), 0),
        func.coalesce(func.sum(APIUsageLog.output_tokens), 0),
        func.coalesce(func.sum(APIUsageLog.total_tokens), 0),
        func.coalesce(func.sum(APIUsageLog.estimated_cost_usd), 0),
    ).filter(APIUsageLog.timestamp >= day_start).first()

    # This month's usage
    monthly_stats = db.query(
        func.count(APIUsageLog.id),
        func.coalesce(func.sum(APIUsageLog.input_tokens), 0),
        func.coalesce(func.sum(APIUsageLog.output_tokens), 0),
        func.coalesce(func.sum(APIUsageLog.total_tokens), 0),
        func.coalesce(func.sum(APIUsageLog.estimated_cost_usd), 0),
    ).filter(APIUsageLog.timestamp >= month_start).first()

    # Per-function breakdown (today)
    breakdown_rows = db.query(
        APIUsageLog.caller,
        func.count(APIUsageLog.id),
        func.coalesce(func.sum(APIUsageLog.total_tokens), 0),
        func.coalesce(func.sum(APIUsageLog.estimated_cost_usd), 0),
    ).filter(
        APIUsageLog.timestamp >= day_start,
    ).group_by(APIUsageLog.caller).all()

    breakdown = [
        {"function": row[0], "calls": row[1], "tokens": row[2], "cost_usd": round(row[3], 6)}
        for row in breakdown_rows
    ]

    # Per-model breakdown (today). Lets the Models section show each model's
    # share of today's activity next to its price card — makes it visible
    # at a glance that both actor + judge are actually being used.
    model_rows = db.query(
        APIUsageLog.model,
        func.count(APIUsageLog.id),
        func.coalesce(func.sum(APIUsageLog.estimated_cost_usd), 0),
    ).filter(
        APIUsageLog.timestamp >= day_start,
        APIUsageLog.status != "reserved",  # don't double-count in-flight rows
    ).group_by(APIUsageLog.model).all()

    breakdown_by_model = {
        row[0]: {"calls": row[1], "cost_usd": round(float(row[2]), 6)}
        for row in model_rows
        if row[0]
    }

    # Recent calls (last 10)
    recent = db.query(APIUsageLog).order_by(APIUsageLog.timestamp.desc()).limit(10).all()
    recent_calls = [
        {
            "id": r.id,
            "caller": r.caller,
            "model": r.model,
            "input_tokens": r.input_tokens,
            "output_tokens": r.output_tokens,
            "total_tokens": r.total_tokens,
            "cost_usd": round(r.estimated_cost_usd, 6),
            "latency_ms": r.latency_ms,
            "status": r.status,
            "timestamp": r.timestamp.replace(tzinfo=timezone.utc).isoformat() if r.timestamp else "",
        }
        for r in recent
    ]

    return {
        "daily": {
            "calls": daily_stats[0],
            "input_tokens": daily_stats[1],
            "output_tokens": daily_stats[2],
            "total_tokens": daily_stats[3],
            "cost_usd": round(float(daily_stats[4]), 6),
            "budget_usd": settings.api_daily_budget,
            "budget_remaining_usd": round(max(settings.api_daily_budget - float(daily_stats[4]), 0), 6),
            "budget_pct_used": round(
                (float(daily_stats[4]) / settings.api_daily_budget * 100)
                if settings.api_daily_budget > 0 else 0, 1
            ),
        },
        "monthly": {
            "calls": monthly_stats[0],
            "input_tokens": monthly_stats[1],
            "output_tokens": monthly_stats[2],
            "total_tokens": monthly_stats[3],
            "cost_usd": round(float(monthly_stats[4]), 6),
            "budget_usd": settings.api_monthly_budget,
            "budget_remaining_usd": round(max(settings.api_monthly_budget - float(monthly_stats[4]), 0), 6),
            "budget_pct_used": round(
                (float(monthly_stats[4]) / settings.api_monthly_budget * 100)
                if settings.api_monthly_budget > 0 else 0, 1
            ),
        },
        "breakdown": breakdown,
        "breakdown_by_model": breakdown_by_model,
        "recent_calls": recent_calls,
    }


@router.get("/performance")
def get_performance(
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    """Detailed performance metrics: percentiles, error breakdown, throughput, efficiency."""
    now = datetime.now(timezone.utc)
    day_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
    hour_ago = now - timedelta(hours=1)

    # Latency percentiles from APIUsageLog (LLM calls, more relevant than HTTP probes)
    latency_logs = (
        db.query(APIUsageLog.latency_ms)
        .filter(APIUsageLog.timestamp >= day_start, APIUsageLog.latency_ms > 0)
        .all()
    )
    latencies = sorted([l[0] for l in latency_logs]) if latency_logs else []

    latency_stats = {
        "avg": round(sum(latencies) / len(latencies), 1) if latencies else 0,
        "p50": round(latencies[len(latencies) // 2], 1) if latencies else 0,
        "p95": round(latencies[int(len(latencies) * 0.95)], 1) if latencies else 0,
        "p99": round(latencies[int(len(latencies) * 0.99)], 1) if latencies else 0,
        "min": round(min(latencies), 1) if latencies else 0,
        "max": round(max(latencies), 1) if latencies else 0,
    }

    # Error breakdown by category
    error_rows = (
        db.query(APIUsageLog.status, func.count(APIUsageLog.id))
        .filter(APIUsageLog.timestamp >= day_start, APIUsageLog.status.like("error_%"))
        .group_by(APIUsageLog.status)
        .all()
    )
    error_breakdown = {row[0].replace("error_", ""): row[1] for row in error_rows}

    # Throughput
    calls_today = db.query(func.count(APIUsageLog.id)).filter(
        APIUsageLog.timestamp >= day_start
    ).scalar()
    calls_this_hour = db.query(func.count(APIUsageLog.id)).filter(
        APIUsageLog.timestamp >= hour_ago
    ).scalar()
    tokens_today = db.query(func.coalesce(func.sum(APIUsageLog.total_tokens), 0)).filter(
        APIUsageLog.timestamp >= day_start
    ).scalar()

    # Efficiency
    cost_today = db.query(func.coalesce(func.sum(APIUsageLog.estimated_cost_usd), 0)).filter(
        APIUsageLog.timestamp >= day_start
    ).scalar()
    avg_tokens = round(tokens_today / calls_today, 0) if calls_today > 0 else 0
    avg_cost = round(float(cost_today) / calls_today, 6) if calls_today > 0 else 0
    tokens_per_dollar = round(tokens_today / float(cost_today), 0) if cost_today > 0 else 0

    return {
        "latency": latency_stats,
        "error_breakdown": error_breakdown,
        "throughput": {
            "calls_today": calls_today,
            "calls_this_hour": calls_this_hour,
            "tokens_today": tokens_today,
        },
        "efficiency": {
            "avg_tokens_per_call": avg_tokens,
            "avg_cost_per_call": avg_cost,
            "tokens_per_dollar": tokens_per_dollar,
        },
    }


@router.get("/api-safety")
def get_api_safety(
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    """Safety metrics: blocked calls, flagged prompts, risk distribution."""
    now = datetime.now(timezone.utc)
    day_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
    month_start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)

    # Total calls scanned today
    total_today = db.query(func.count(APIUsageLog.id)).filter(
        APIUsageLog.timestamp >= day_start
    ).scalar()

    # Blocked today (safety rejections)
    blocked_today = db.query(func.count(APIUsageLog.id)).filter(
        APIUsageLog.timestamp >= day_start,
        APIUsageLog.status == "blocked_safety",
    ).scalar()

    # Blocked this month
    blocked_month = db.query(func.count(APIUsageLog.id)).filter(
        APIUsageLog.timestamp >= month_start,
        APIUsageLog.status == "blocked_safety",
    ).scalar()

    # Calls with any safety flags (not blocked, but flagged)
    flagged_today = db.query(func.count(APIUsageLog.id)).filter(
        APIUsageLog.timestamp >= day_start,
        APIUsageLog.safety_flags != "",
        APIUsageLog.status != "blocked_safety",
    ).scalar()

    # Flag frequency breakdown
    flagged_logs = (
        db.query(APIUsageLog.safety_flags)
        .filter(
            APIUsageLog.timestamp >= day_start,
            APIUsageLog.safety_flags != "",
        )
        .all()
    )
    flag_counts = {}
    for row in flagged_logs:
        for flag in row[0].split(","):
            flag = flag.strip()
            if flag:
                flag_counts[flag] = flag_counts.get(flag, 0) + 1

    # Average risk score today
    avg_risk = db.query(func.avg(APIUsageLog.risk_score)).filter(
        APIUsageLog.timestamp >= day_start,
        APIUsageLog.risk_score > 0,
    ).scalar() or 0

    # Recent blocked calls
    recent_blocked = (
        db.query(APIUsageLog)
        .filter(APIUsageLog.status == "blocked_safety")
        .order_by(APIUsageLog.timestamp.desc())
        .limit(5)
        .all()
    )
    recent_blocked_list = [
        {
            "caller": r.caller,
            "safety_flags": r.safety_flags,
            "risk_score": r.risk_score,
            "timestamp": r.timestamp.replace(tzinfo=timezone.utc).isoformat() if r.timestamp else "",
        }
        for r in recent_blocked
    ]

    return {
        "total_scanned_today": total_today,
        "blocked_today": blocked_today,
        "blocked_this_month": blocked_month,
        "flagged_today": flagged_today,
        "flag_breakdown": flag_counts,
        "avg_risk_score": round(avg_risk, 1),
        "recent_blocked": recent_blocked_list,
    }


# ── LLM Call Trace Detail (inspired by LangSmith) ──

@router.get("/api-calls/{call_id}")
def get_call_detail(
    call_id: int,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    """Get full trace of an LLM call including prompt and response text."""
    call = db.query(APIUsageLog).filter(APIUsageLog.id == call_id).first()
    if not call:
        raise HTTPException(status_code=404, detail="Call not found")

    service = db.query(AIService).filter(AIService.id == call.service_id).first() if call.service_id else None

    return {
        "id": call.id,
        "caller": call.caller,
        "model": call.model,
        "service_name": service.name if service else None,
        "input_tokens": call.input_tokens,
        "output_tokens": call.output_tokens,
        "total_tokens": call.total_tokens,
        "cost_usd": round(call.estimated_cost_usd, 6),
        "latency_ms": call.latency_ms,
        "status": call.status,
        "safety_flags": call.safety_flags,
        "risk_score": call.risk_score,
        "prompt_text": call.prompt_text or "",
        "response_text": call.response_text or "",
        "timestamp": call.timestamp.replace(tzinfo=timezone.utc).isoformat() if call.timestamp else "",
    }


# ── Cost by Service (inspired by Helicone/Datadog) ──

@router.get("/cost-by-service")
def get_cost_by_service(
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    """Cost breakdown by AI service."""
    now = datetime.now(timezone.utc)
    month_start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)

    rows = (
        db.query(
            AIService.name,
            func.count(APIUsageLog.id),
            func.coalesce(func.sum(APIUsageLog.total_tokens), 0),
            func.coalesce(func.sum(APIUsageLog.estimated_cost_usd), 0),
        )
        .join(AIService, APIUsageLog.service_id == AIService.id)
        .filter(APIUsageLog.timestamp >= month_start)
        .group_by(AIService.name)
        .all()
    )

    return [
        {"service": row[0], "calls": row[1], "tokens": row[2], "cost_usd": round(row[3], 6)}
        for row in rows
    ]


# ── Alert System (inspired by Datadog/PagerDuty) ──

@router.get("/alerts")
def list_alerts(
    active_only: bool = Query(True),
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    """List alerts, optionally filtered to active (unacknowledged) only."""
    query = db.query(Alert).order_by(Alert.created_at.desc())
    if active_only:
        query = query.filter(Alert.acknowledged == False)
    alerts = query.limit(50).all()

    result = []
    for a in alerts:
        service = db.query(AIService).filter(AIService.id == a.service_id).first() if a.service_id else None
        result.append({
            "id": a.id,
            "type": a.alert_type,
            "severity": a.severity,
            "message": a.message,
            "service_name": service.name if service else None,
            "acknowledged": a.acknowledged,
            "created_at": a.created_at.replace(tzinfo=timezone.utc).isoformat() if a.created_at else "",
        })
    return result


@router.post(
    "/alerts/{alert_id}/acknowledge",
    dependencies=[Depends(require_role(["admin", "maintainer"]))],
)
def acknowledge_alert(
    alert_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Acknowledge an alert (dismiss it)."""
    alert = db.query(Alert).filter(Alert.id == alert_id).first()
    if not alert:
        raise HTTPException(status_code=404, detail="Alert not found")

    alert.acknowledged = True
    alert.acknowledged_by = current_user.id
    alert.acknowledged_at = datetime.now(timezone.utc)
    db.commit()
    return {"detail": "Alert acknowledged", "id": alert_id}
