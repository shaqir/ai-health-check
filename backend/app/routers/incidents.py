"""
Incidents Router — Module 3: Triage & LLM Summary
Full CRUD operations + AI-assisted summary drafting.
"""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from pydantic import BaseModel
from typing import List, Optional
from datetime import datetime

from app.database import get_db
from app.models import (
    Incident, IncidentStatus, Severity, AIService, User,
)
from app.middleware.auth import get_current_user
from app.middleware.rbac import require_role
from app.middleware.audit import log_action
from app.services.llm_client import generate_summary

router = APIRouter()


# ── Schemas ──

class IncidentCreate(BaseModel):
    service_id: int
    severity: str
    symptoms: str
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
    timeline: Optional[datetime] = None
    checklist_data_issue: bool
    checklist_prompt_change: bool
    checklist_model_update: bool
    checklist_infrastructure: bool
    checklist_safety_policy: bool
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


# ── Endpoints ──

@router.get("", response_model=List[IncidentResponse])
def list_incidents(
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    """List all incidents globally."""
    incidents = db.query(Incident).order_by(Incident.created_at.desc()).all()
    
    result = []
    for inc in incidents:
        service = db.query(AIService).filter(AIService.id == inc.service_id).first()
        result.append(IncidentResponse(
            id=inc.id,
            service_id=inc.service_id,
            service_name=service.name if service else "Unknown Service",
            severity=inc.severity.value,
            symptoms=inc.symptoms,
            status=inc.status.value,
            summary=inc.summary,
            summary_draft=inc.summary_draft,
            root_causes=inc.root_causes,
            checklist_data_issue=inc.checklist_data_issue,
            checklist_prompt_change=inc.checklist_prompt_change,
            checklist_model_update=inc.checklist_model_update,
            checklist_infrastructure=inc.checklist_infrastructure,
            checklist_safety_policy=inc.checklist_safety_policy,
            created_at=inc.created_at,
            updated_at=inc.updated_at,
        ))
    return result


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

    return IncidentResponse(
        id=incident.id,
        service_id=incident.service_id,
        service_name=service.name,
        severity=incident.severity.value,
        symptoms=incident.symptoms,
        status=incident.status.value,
        summary=incident.summary,
        summary_draft=incident.summary_draft,
        root_causes=incident.root_causes,
        checklist_data_issue=incident.checklist_data_issue,
        checklist_prompt_change=incident.checklist_prompt_change,
        checklist_model_update=incident.checklist_model_update,
        checklist_infrastructure=incident.checklist_infrastructure,
        checklist_safety_policy=incident.checklist_safety_policy,
        created_at=incident.created_at,
        updated_at=incident.updated_at,
    )


@router.post(
    "/{incident_id}/generate-summary",
    response_model=dict,
    dependencies=[Depends(require_role(["admin", "maintainer"]))],
)
async def generate_incident_summary(
    incident_id: int,
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
    )
    
    incident.summary_draft = result["summary_draft"]
    incident.root_causes = result["root_causes_draft"]
    db.commit()
    
    log_action(db, current_user.id, "generate_summary_draft", "incidents", incident.id)
    
    return {"message": "Draft generated successfully", "draft": result["summary_draft"]}


@router.post(
    "/{incident_id}/approve-summary",
    response_model=dict,
    dependencies=[Depends(require_role(["admin", "maintainer"]))],
)
def approve_summary(
    incident_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Approve the drafted summary and move it to the official summary field."""
    incident = db.query(Incident).filter(Incident.id == incident_id).first()
    if not incident:
        raise HTTPException(status_code=404, detail="Incident not found")
        
    if not incident.summary_draft:
        raise HTTPException(status_code=400, detail="No draft summary exists to approve")
        
    incident.summary = incident.summary_draft
    incident.summary_draft = ""
    incident.approved_by = current_user.id
    db.commit()
    
    log_action(db, current_user.id, "approve_summary", "incidents", incident.id)
    
    return {"message": "Summary approved and published"}
