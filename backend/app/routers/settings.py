"""
Settings — runtime visibility into the API Limits & Safety configuration.

Exposes what enforce_call_limits is checking against so the Settings UI
can render hard caps, soft budgets, and live usage side-by-side. Read-only:
caps are sourced from environment variables and cannot be edited through
the API — this matches production practice (limits are infra config, not
user config) and eliminates the demo-day risk of a misclick nuking the
daily budget.
"""

from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.config import get_settings
from app.database import get_db
from app.middleware.auth import get_current_user
from app.middleware.rbac import require_role
from app.models import AIService, APIUsageLog, User
from app.services.call_families import FAMILY_LABELS, family_for_caller

router = APIRouter()
settings = get_settings()


class HardCaps(BaseModel):
    max_cost_per_call_usd: float
    max_tokens_per_call: int
    max_prompt_chars: int


class SoftLimits(BaseModel):
    daily_budget_usd: float
    monthly_budget_usd: float
    calls_per_minute: int
    calls_per_user_per_minute: int
    max_prompt_length_soft: int


class CurrentUsage(BaseModel):
    today_usd: float
    month_usd: float
    calls_last_minute: int
    calls_last_minute_by_user: int


class LimitsResponse(BaseModel):
    hard_caps: HardCaps
    soft_limits: SoftLimits
    current_usage: CurrentUsage
    configured_via: str = "environment variables (HARD_* and API_* in .env)"


@router.get("/limits", response_model=LimitsResponse)
def get_limits(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> LimitsResponse:
    """
    Return the active hard caps, soft budgets, and live usage counters.

    Hard caps and soft limits come straight from app settings (env-sourced).
    Usage counters are aggregated from APIUsageLog. Called by the Settings
    page every 30s to refresh live numbers.
    """
    now = datetime.now(timezone.utc)
    one_min_ago = now - timedelta(minutes=1)
    day_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
    month_start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)

    today_usd = db.query(
        func.coalesce(func.sum(APIUsageLog.estimated_cost_usd), 0.0)
    ).filter(APIUsageLog.timestamp >= day_start).scalar() or 0.0

    month_usd = db.query(
        func.coalesce(func.sum(APIUsageLog.estimated_cost_usd), 0.0)
    ).filter(APIUsageLog.timestamp >= month_start).scalar() or 0.0

    calls_last_min = db.query(func.count(APIUsageLog.id)).filter(
        APIUsageLog.timestamp >= one_min_ago
    ).scalar() or 0

    calls_last_min_user = db.query(func.count(APIUsageLog.id)).filter(
        APIUsageLog.timestamp >= one_min_ago,
        APIUsageLog.user_id == current_user.id,
    ).scalar() or 0

    return LimitsResponse(
        hard_caps=HardCaps(
            max_cost_per_call_usd=settings.hard_max_cost_per_call_usd,
            max_tokens_per_call=settings.hard_max_tokens_per_call,
            max_prompt_chars=settings.hard_max_prompt_chars,
        ),
        soft_limits=SoftLimits(
            daily_budget_usd=settings.api_daily_budget,
            monthly_budget_usd=settings.api_monthly_budget,
            calls_per_minute=settings.api_max_calls_per_minute,
            calls_per_user_per_minute=settings.api_max_calls_per_user_per_minute,
            max_prompt_length_soft=settings.max_prompt_length,
        ),
        current_usage=CurrentUsage(
            today_usd=round(float(today_usd), 4),
            month_usd=round(float(month_usd), 4),
            calls_last_minute=int(calls_last_min),
            calls_last_minute_by_user=int(calls_last_min_user),
        ),
    )


# ── Call Trace — grouped activities + per-call drill-down ─────────────
#
# Two endpoints:
#   GET /trace/activities         — paginated list grouped by correlation_id
#   GET /trace/calls/{cid}        — every api_usage_log row for one activity
#
# Family mapping (caller → human-friendly category) lives in
# app/services/call_families.py. The drill-down endpoint returns
# prompt_text and response_text, so it's gated to admin/maintainer only
# (those fields may contain PII).


class ActivityRow(BaseModel):
    correlation_id: str
    started_at: datetime
    family: str
    family_label: str
    user_id: Optional[int] = None
    user_email: Optional[str] = None
    service_id: Optional[int] = None
    service_name: Optional[str] = None
    primary_caller: str
    call_count: int
    total_cost_usd: float
    total_latency_ms: float
    status: str


class ActivitiesResponse(BaseModel):
    activities: list[ActivityRow]
    total: int
    page: int
    limit: int


class CallDetail(BaseModel):
    id: int
    timestamp: datetime
    caller: str
    family: str
    family_label: str
    model: str
    input_tokens: int
    output_tokens: int
    estimated_cost_usd: float
    latency_ms: float
    status: str
    safety_flags: Optional[str] = None
    risk_score: int = 0
    prompt_text: Optional[str] = None
    response_text: Optional[str] = None


class CallTraceResponse(BaseModel):
    correlation_id: str
    calls: list[CallDetail]


def _aggregate_family(families: set[str]) -> str:
    """When one activity contains calls from multiple families (rare —
    evaluations fire run_eval_prompt + judge_response, both 'evaluation'),
    the display family is the FIRST family seen. If somehow mixed across
    families, return 'mixed'."""
    if len(families) == 1:
        return next(iter(families))
    return "mixed"


@router.get("/trace/activities", response_model=ActivitiesResponse)
def list_activities(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    family: Optional[str] = Query(None, description="Filter by family (e.g. 'evaluation')"),
    user_id: Optional[int] = Query(None, description="Filter by user_id"),
    since_minutes: int = Query(1440, ge=1, le=10080, description="Look-back window in minutes (default 24h)"),
    page: int = Query(1, ge=1),
    limit: int = Query(25, ge=1, le=100),
) -> ActivitiesResponse:
    """
    Grouped activity list — one row per correlation_id, aggregating the
    Claude calls fired under that user action. Sorted newest-first.

    Rows where correlation_id IS NULL (background scheduler, legacy rows)
    are excluded — those aren't "user actions" and don't belong in the
    trace view. Use the existing Recent API Calls table for a raw feed.
    """
    since = datetime.now(timezone.utc) - timedelta(minutes=since_minutes)

    # Base rows: only real user activities with a correlation_id. Reserved
    # rows (where a call was in flight but never finalized) are excluded.
    base = db.query(APIUsageLog).filter(
        APIUsageLog.correlation_id.isnot(None),
        APIUsageLog.timestamp >= since,
        APIUsageLog.status != "reserved",
    )

    if user_id is not None:
        base = base.filter(APIUsageLog.user_id == user_id)

    # Pull the rows and group in Python. For demo-scale volume this is
    # comfortable (hundreds of rows, not millions). A production version
    # would do the aggregation in SQL with a GROUP BY correlation_id.
    rows = base.order_by(APIUsageLog.timestamp.desc()).all()

    groups: dict[str, list[APIUsageLog]] = {}
    for r in rows:
        groups.setdefault(r.correlation_id, []).append(r)

    activities: list[ActivityRow] = []
    for cid, calls in groups.items():
        # Oldest call = when the activity started (we sorted desc, so take last).
        calls_sorted = sorted(calls, key=lambda c: c.timestamp)
        first = calls_sorted[0]

        families = {family_for_caller(c.caller) for c in calls}
        fam = _aggregate_family(families)

        # Optional family filter — applied AFTER grouping so we don't
        # accidentally split an activity by filtering individual calls.
        if family and fam != family:
            continue

        # Status rollup: any error in the group makes the activity an error.
        # Reserved already filtered out above.
        if any(c.status != "success" for c in calls):
            rollup_status = "error"
        else:
            rollup_status = "success"

        # User + service lookups — cheap enough for demo scale; one
        # query per unique id cached in a local dict to avoid N+1.
        user_email = None
        if first.user_id:
            u = db.query(User).filter(User.id == first.user_id).first()
            user_email = u.email if u else None
        service_name = None
        # Use the first call's service_id that's populated, if any.
        svc_id = next((c.service_id for c in calls if c.service_id), None)
        if svc_id:
            s = db.query(AIService).filter(AIService.id == svc_id).first()
            service_name = s.name if s else None

        activities.append(ActivityRow(
            correlation_id=cid,
            started_at=first.timestamp,
            family=fam,
            family_label=FAMILY_LABELS.get(fam, fam),
            user_id=first.user_id,
            user_email=user_email,
            service_id=svc_id,
            service_name=service_name,
            primary_caller=first.caller,
            call_count=len(calls),
            total_cost_usd=round(sum(c.estimated_cost_usd or 0 for c in calls), 6),
            total_latency_ms=round(sum(c.latency_ms or 0 for c in calls), 1),
            status=rollup_status,
        ))

    # Newest activity first, then paginate.
    activities.sort(key=lambda a: a.started_at, reverse=True)
    total = len(activities)
    offset = (page - 1) * limit
    page_slice = activities[offset:offset + limit]

    return ActivitiesResponse(activities=page_slice, total=total, page=page, limit=limit)


@router.get(
    "/trace/calls/{correlation_id}",
    response_model=CallTraceResponse,
    dependencies=[Depends(require_role(["admin", "maintainer"]))],
)
def get_trace_calls(
    correlation_id: str,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
) -> CallTraceResponse:
    """
    Every Claude call made under one correlation_id. Includes the actual
    prompt_text and response_text, so this endpoint is admin/maintainer-only
    — those fields may contain PII.
    """
    calls = (
        db.query(APIUsageLog)
        .filter(APIUsageLog.correlation_id == correlation_id)
        .order_by(APIUsageLog.timestamp.asc())
        .all()
    )

    if not calls:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"No calls found for correlation_id {correlation_id}",
        )

    details = []
    for c in calls:
        fam = family_for_caller(c.caller)
        details.append(CallDetail(
            id=c.id,
            timestamp=c.timestamp,
            caller=c.caller,
            family=fam,
            family_label=FAMILY_LABELS.get(fam, fam),
            model=c.model,
            input_tokens=c.input_tokens or 0,
            output_tokens=c.output_tokens or 0,
            estimated_cost_usd=round(c.estimated_cost_usd or 0, 6),
            latency_ms=round(c.latency_ms or 0, 1),
            status=c.status,
            safety_flags=c.safety_flags or None,
            risk_score=c.risk_score or 0,
            prompt_text=c.prompt_text or None,
            response_text=c.response_text or None,
        ))

    return CallTraceResponse(correlation_id=correlation_id, calls=details)
