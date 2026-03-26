"""
Maintenance Router — Module 3: Maintenance Planning
"""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from pydantic import BaseModel
from typing import List
from datetime import datetime

from app.database import get_db
from app.models import MaintenancePlan, Incident, Severity, User
from app.middleware.auth import get_current_user
from app.middleware.rbac import require_role
from app.middleware.audit import log_action

router = APIRouter()


class MaintenanceCreate(BaseModel):
    incident_id: int
    risk_level: str
    rollback_plan: str
    validation_steps: str
    scheduled_date: Optional[str] = None
    human_approved: bool = False


class MaintenanceResponse(BaseModel):
    id: int
    incident_id: int
    risk_level: str
    rollback_plan: str
    validation_steps: str
    approved: bool
    scheduled_date: Optional[datetime] = None
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


@router.get("", response_model=List[MaintenanceResponse])
def list_maintenance_plans(
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    """List all maintenance plans."""
    plans = db.query(MaintenancePlan).all()
    return [
        MaintenanceResponse(
            id=p.id,
            incident_id=p.incident_id,
            risk_level=p.risk_level.value,
            rollback_plan=p.rollback_plan,
            validation_steps=p.validation_steps,
            approved=p.approved,
            created_at=p.created_at,
            updated_at=p.updated_at,
        ) for p in plans
    ]


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
    """Create a new maintenance plan linked to an incident."""
    incident = db.query(Incident).filter(Incident.id == req.incident_id).first()
    if not incident:
        raise HTTPException(status_code=404, detail="Linked Incident not found")

    try:
        r_level = Severity(req.risk_level)
    except ValueError as e:
        raise HTTPException(status_code=400, detail="Invalid risk severity")

    from datetime import datetime as dt
    sched = None
    if req.scheduled_date:
        try:
            sched = dt.fromisoformat(req.scheduled_date)
        except ValueError:
            pass
    plan = MaintenancePlan(
        incident_id=req.incident_id,
        risk_level=r_level,
        rollback_plan=req.rollback_plan,
        validation_steps=req.validation_steps,
        scheduled_date=sched,
        approved=req.human_approved,
    )
    db.add(plan)
    db.commit()
    db.refresh(plan)

    log_action(db, current_user.id, "create_maintenance_plan", "maintenance_plans", plan.id)

    return MaintenanceResponse(
        id=plan.id,
        incident_id=plan.incident_id,
        risk_level=plan.risk_level.value,
        rollback_plan=plan.rollback_plan,
        validation_steps=plan.validation_steps,
        approved=plan.approved,
        created_at=plan.created_at,
        updated_at=plan.updated_at,
    )


@router.put(
    "/{plan_id}/approve",
    dependencies=[Depends(require_role(["admin"]))], # Example restriction
)
def approve_plan(
    plan_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Approve a maintenance plan."""
    plan = db.query(MaintenancePlan).filter(MaintenancePlan.id == plan_id).first()
    if not plan:
        raise HTTPException(status_code=404, detail="Plan not found")
        
    plan.approved = True
    db.commit()
    
    log_action(db, current_user.id, "approve_maintenance_plan", "maintenance_plans", plan.id)
    return {"message": "Plan approved successfully"}
