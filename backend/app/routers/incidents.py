"""
Incidents Router — Module 3: Triage & LLM Summary
Full CRUD operations + AI-assisted summary drafting.
"""

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session
from pydantic import BaseModel, Field
from typing import List, Optional
from datetime import datetime, timezone

from app.database import get_db
from app.models import (
    Incident, IncidentStatus, Severity, AIService, User,
)
from app.middleware.auth import get_current_user
from app.middleware.rbac import require_role
from app.middleware.audit import log_action
from app.services.env_filter import apply_env_filter
from app.services.llm_client import generate_summary
from app.services.sensitivity import enforce_sensitivity

router = APIRouter()


# ── Schemas ──

class IncidentCreate(BaseModel):
    service_id: int
    severity: str
    symptoms: str = Field(..., max_length=5000)
    timeline: Optional[datetime] = None
    checklist_data_issue: bool = False
    checklist_prompt_change: bool = False
    checklist_model_update: bool = False
    checklist_infrastructure: bool = False
    checklist_safety_policy: bool = False


class IncidentUpdate(BaseModel):
    severity: Optional[str] = None
    symptoms: Optional[str] = None
    status: Optional[str] = None


class IncidentResponse(BaseModel):
    id: int
    service_id: int
    service_name: str
    severity: str
    symptoms: str
    status: str
    summary: str
    summary_draft: str
    root_causes: str
    # Timestamps are strings carrying ISO-8601 with explicit +00:00 so the
    # frontend can parse via new Date() and render in the viewer's timezone.
    # SQLite drops tzinfo on write, so we re-attach UTC here.
    timeline: Optional[str] = None
    checklist_data_issue: bool
    checklist_prompt_change: bool
    checklist_model_update: bool
    checklist_infrastructure: bool
    checklist_safety_policy: bool
    # HITL attribution — frontend renders "Approved by X at Y" so the
    # reviewer_note enforcement is visibly connected to a human.
    approved_by_email: Optional[str] = None
    approved_at: Optional[str] = None
    reviewer_note: Optional[str] = None
    created_at: str
    updated_at: str


def _iso_utc(value: Optional[datetime]) -> Optional[str]:
    """Serialize a naive-UTC datetime as ISO-8601 with explicit +00:00 offset.
    Matches Dashboard/Maintenance convention."""
    if value is None:
        return None
    return value.replace(tzinfo=timezone.utc).isoformat()


def _serialize_incident(inc: Incident, db: Session) -> IncidentResponse:
    """Shared serializer — includes service name + approver attribution."""
    service = db.query(AIService).filter(AIService.id == inc.service_id).first()
    approver_email = None
    if inc.approved_by:
        approver = db.query(User).filter(User.id == inc.approved_by).first()
        approver_email = approver.email if approver else None
    return IncidentResponse(
        id=inc.id,
        service_id=inc.service_id,
        service_name=service.name if service else "Unknown Service",
        severity=inc.severity.value,
        symptoms=inc.symptoms,
        status=inc.status.value,
        summary=inc.summary,
        summary_draft=inc.summary_draft,
        root_causes=inc.root_causes,
        timeline=_iso_utc(inc.timeline),
        checklist_data_issue=inc.checklist_data_issue,
        checklist_prompt_change=inc.checklist_prompt_change,
        checklist_model_update=inc.checklist_model_update,
        checklist_infrastructure=inc.checklist_infrastructure,
        checklist_safety_policy=inc.checklist_safety_policy,
        approved_by_email=approver_email,
        approved_at=_iso_utc(inc.approved_at),
        reviewer_note=inc.reviewer_note,
        created_at=_iso_utc(inc.created_at),
        updated_at=_iso_utc(inc.updated_at),
    )


# ── Endpoints ──

@router.get("", response_model=List[IncidentResponse])
def list_incidents(
    environment: Optional[str] = Query(None),
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    """List incidents, optionally scoped to a service environment."""
    query = apply_env_filter(db.query(Incident), environment)
    incidents = query.order_by(Incident.created_at.desc()).all()
    return [_serialize_incident(inc, db) for inc in incidents]


@router.post(
    "",
    response_model=IncidentResponse,
    dependencies=[Depends(require_role(["admin", "maintainer"]))],
)
def create_incident(
    req: IncidentCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Report a new incident."""
    service = db.query(AIService).filter(AIService.id == req.service_id).first()
    if not service:
        raise HTTPException(status_code=404, detail="Service not found")
        
    try:
        sev_enum = Severity(req.severity)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=f"Invalid severity: {req.severity}")

    incident = Incident(
        service_id=req.service_id,
        severity=sev_enum,
        status=IncidentStatus.open,
        symptoms=req.symptoms,
        timeline=req.timeline,
        checklist_data_issue=req.checklist_data_issue,
        checklist_prompt_change=req.checklist_prompt_change,
        checklist_model_update=req.checklist_model_update,
        checklist_infrastructure=req.checklist_infrastructure,
        checklist_safety_policy=req.checklist_safety_policy,
    )
    db.add(incident)
    db.commit()
    db.refresh(incident)

    log_action(db, current_user.id, "create_incident", "incidents", incident.id)

    return _serialize_incident(incident, db)


@router.post(
    "/{incident_id}/generate-summary",
    response_model=dict,
    dependencies=[Depends(require_role(["admin", "maintainer"]))],
)
async def generate_incident_summary(
    incident_id: int,
    allow_confidential: bool = Query(False, description="Admin override for confidential services"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Calls LLM to draft a summary and identify root causes.
    Saves to the draft columns for human review.
    """
    incident = db.query(Incident).filter(Incident.id == incident_id).first()
    if not incident:
        raise HTTPException(status_code=404, detail="Incident not found")

    service = db.query(AIService).filter(AIService.id == incident.service_id).first()
    if service:
        enforce_sensitivity(db, service, current_user, allow_confidential=allow_confidential)

    checklist = {
        "Data Issue": incident.checklist_data_issue,
        "Prompt Change": incident.checklist_prompt_change,
        "Model Update": incident.checklist_model_update,
        "Infrastructure": incident.checklist_infrastructure,
        "Safety Policy": incident.checklist_safety_policy,
    }

    result = await generate_summary(
        service_name=service.name if service else "Unknown AI Service",
        severity=incident.severity.value,
        symptoms=incident.symptoms,
        checklist=checklist,
        user_id=current_user.id,
        service_id=service.id if service else None,
    )
    
    incident.summary_draft = result["summary_draft"]
    incident.root_causes = result["root_causes_draft"]
    db.commit()
    
    log_action(db, current_user.id, "generate_summary_draft", "incidents", incident.id)
    
    return {"message": "Draft generated successfully", "draft": result["summary_draft"]}


class ApproveSummaryRequest(BaseModel):
    # Mandatory reviewer note. At least 20 non-whitespace chars forces
    # the human in the loop to articulate what they read rather than
    # rubber-stamp the LLM's output. Closes the hostile-QA finding
    # where an attacker-authored incident (via prompt injection in
    # symptoms) could produce a draft that an admin approved without
    # reading carefully.
    reviewer_note: str = Field(..., min_length=20, max_length=2000)


@router.post(
    "/{incident_id}/approve-summary",
    response_model=dict,
    dependencies=[Depends(require_role(["admin", "maintainer"]))],
)
def approve_summary(
    incident_id: int,
    req: ApproveSummaryRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Approve the drafted summary and move it to the official summary field."""
    incident = db.query(Incident).filter(Incident.id == incident_id).first()
    if not incident:
        raise HTTPException(status_code=404, detail="Incident not found")

    # Idempotency guard — re-approving a previously approved incident
    # silently overwrote approved_by, losing attribution under races.
    if incident.summary and incident.approved_by:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=(
                f"Summary already approved by user {incident.approved_by}"
                f"{f' at {incident.approved_at.isoformat()}' if incident.approved_at else ''}"
            ),
        )

    if not incident.summary_draft:
        raise HTTPException(status_code=400, detail="No draft summary exists to approve")

    # Normalize and re-check length after stripping whitespace — catches
    # 20 spaces as insufficient.
    note = req.reviewer_note.strip()
    if len(note) < 20:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="reviewer_note must contain at least 20 non-whitespace characters",
        )

    incident.summary = incident.summary_draft
    incident.summary_draft = ""
    incident.approved_by = current_user.id
    incident.approved_at = datetime.now(timezone.utc).replace(tzinfo=None)
    incident.reviewer_note = note
    db.commit()

    log_action(
        db, current_user.id, "approve_summary", "incidents", incident.id,
        new_value=f"reviewer_note_len={len(note)}",
    )

    return {
        "message": "Summary approved and published",
        "approved_by": current_user.id,
        "approved_at": incident.approved_at,
    }
