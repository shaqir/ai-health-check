"""
Maintenance Router — Module 3: Maintenance Planning
"""

from datetime import datetime, timezone
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.database import get_db
from app.middleware.audit import log_action
from app.middleware.auth import get_current_user
from app.middleware.rbac import require_role
from app.models import AIService, Incident, MaintenancePlan, Severity, User
from app.services.env_filter import apply_env_filter

router = APIRouter()


class MaintenanceCreate(BaseModel):
    incident_id: int
    risk_level: str
    rollback_plan: str = Field(..., min_length=1, max_length=5000)
    validation_steps: str = Field(..., min_length=1, max_length=5000)
    scheduled_date: Optional[str] = None
    # human_approved intentionally absent — plans start unapproved. Approval
    # goes through the explicit PUT /{id}/approve endpoint so it's attributed
    # and audited.


class MaintenanceResponse(BaseModel):
    id: int
    incident_id: int
    risk_level: str
    rollback_plan: str
    validation_steps: str
    approved: bool
    approved_by_email: Optional[str] = None
    approved_at: Optional[str] = None
    scheduled_date: Optional[str] = None
    created_at: str
    updated_at: str


def _iso_utc(value: Optional[datetime]) -> Optional[str]:
    """Serialize a naive-UTC datetime as ISO-8601 with explicit +00:00 offset.

    SQLite drops tzinfo on write, but every app write path uses utcnow(), so
    re-attaching UTC here is always correct. Matches Dashboard convention
    and lets the frontend render in the viewer's local timezone.
    """
    if value is None:
        return None
    return value.replace(tzinfo=timezone.utc).isoformat()


def _serialize_plan(plan: MaintenancePlan, approver_email: Optional[str]) -> MaintenanceResponse:
    return MaintenanceResponse(
        id=plan.id,
        incident_id=plan.incident_id,
        risk_level=plan.risk_level.value,
        rollback_plan=plan.rollback_plan,
        validation_steps=plan.validation_steps,
        approved=plan.approved,
        approved_by_email=approver_email,
        approved_at=_iso_utc(plan.approved_at),
        scheduled_date=_iso_utc(plan.scheduled_date),
        created_at=_iso_utc(plan.created_at),
        updated_at=_iso_utc(plan.updated_at),
    )


@router.get("", response_model=List[MaintenanceResponse])
def list_maintenance_plans(
    incident_id: Optional[int] = Query(None),
    environment: Optional[str] = Query(None),
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    """List maintenance plans, optionally filtered by incident_id or service environment."""
    query = db.query(MaintenancePlan)
    if incident_id is not None:
        query = query.filter(MaintenancePlan.incident_id == incident_id)
    if environment and environment != "all":
        # env filter joins through Incident → AIService so we can scope
        # plans by their incident's service environment.
        query = query.join(Incident, Incident.id == MaintenancePlan.incident_id)
        query = apply_env_filter(query, environment)

    plans = query.all()

    # Collect approver emails in one lookup to avoid N+1.
    approver_ids = {p.approved_by for p in plans if p.approved_by is not None}
    emails = {}
    if approver_ids:
        for u in db.query(User).filter(User.id.in_(approver_ids)).all():
            emails[u.id] = u.email

    return [_serialize_plan(p, emails.get(p.approved_by)) for p in plans]


@router.post(
    "",
    response_model=MaintenanceResponse,
    dependencies=[Depends(require_role(["admin", "maintainer"]))],
)
def create_maintenance_plan(
    req: MaintenanceCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Create a new maintenance plan linked to an incident. Always starts
    unapproved — the explicit /approve endpoint is the only path to approval.
    """
    incident = db.query(Incident).filter(Incident.id == req.incident_id).first()
    if not incident:
        raise HTTPException(status_code=404, detail="Linked Incident not found")

    try:
        r_level = Severity(req.risk_level)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid risk severity")

    sched = None
    if req.scheduled_date:
        try:
            sched = datetime.fromisoformat(req.scheduled_date)
            # Store as naive UTC to match the DB convention — if the caller
            # sent a tz-aware datetime, convert then drop tzinfo.
            if sched.tzinfo is not None:
                sched = sched.astimezone(timezone.utc).replace(tzinfo=None)
        except ValueError:
            raise HTTPException(status_code=400, detail="Invalid scheduled_date (expected ISO-8601)")

    plan = MaintenancePlan(
        incident_id=req.incident_id,
        risk_level=r_level,
        rollback_plan=req.rollback_plan,
        validation_steps=req.validation_steps,
        scheduled_date=sched,
        approved=False,
    )
    db.add(plan)
    db.commit()
    db.refresh(plan)

    log_action(db, current_user.id, "create_maintenance_plan", "maintenance_plans", plan.id)

    return _serialize_plan(plan, approver_email=None)


@router.put(
    "/{plan_id}/approve",
    response_model=MaintenanceResponse,
    dependencies=[Depends(require_role(["admin"]))],
)
def approve_plan(
    plan_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Approve a maintenance plan. Records approver + timestamp. Idempotent:
    a second approval returns 409 so duplicate audit rows can't be created.
    """
    plan = db.query(MaintenancePlan).filter(MaintenancePlan.id == plan_id).first()
    if not plan:
        raise HTTPException(status_code=404, detail="Plan not found")

    if plan.approved:
        raise HTTPException(status_code=409, detail="Plan is already approved")

    plan.approved = True
    plan.approved_by = current_user.id
    plan.approved_at = datetime.now(timezone.utc).replace(tzinfo=None)
    db.commit()
    db.refresh(plan)

    log_action(
        db, current_user.id, "approve_maintenance_plan", "maintenance_plans", plan.id,
        new_value=f"risk={plan.risk_level.value}",
    )

    return _serialize_plan(plan, approver_email=current_user.email)
