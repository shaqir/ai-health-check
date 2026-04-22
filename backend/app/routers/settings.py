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

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.config import get_settings
from app.database import get_db
from app.middleware.auth import get_current_user
from app.models import APIUsageLog, User

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
