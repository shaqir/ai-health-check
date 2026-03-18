"""
Services Router — Module 1: AI Service Registry & Connection
Full CRUD + Test Connection endpoint.
"""

import json
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from pydantic import BaseModel

from app.database import get_db
from app.models import (
    AIService, ConnectionLog, User,
    Environment, SensitivityLabel,
)
from app.middleware.auth import get_current_user
from app.middleware.rbac import require_role
from app.middleware.audit import log_action
from app.services.llm_client import test_connection as llm_test_connection

router = APIRouter()


# ── Schemas ──

class ServiceCreate(BaseModel):
    name: str
    owner: str
    environment: str  # "dev" or "prod"
    model_name: str
    sensitivity_label: str  # "public", "internal", or "confidential"
    endpoint_url: str = ""


class ServiceUpdate(BaseModel):
    name: str | None = None
    owner: str | None = None
    environment: str | None = None
    model_name: str | None = None
    sensitivity_label: str | None = None
    endpoint_url: str | None = None
    is_active: bool | None = None


class ServiceResponse(BaseModel):
    id: int
    name: str
    owner: str
    environment: str
    model_name: str
    sensitivity_label: str
    endpoint_url: str
    is_active: bool

    class Config:
        from_attributes = True


# ── Endpoints ──

@router.get("/", response_model=list[ServiceResponse])
def list_services(
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),  # Any authenticated user
):
    """List all registered AI services."""
    services = db.query(AIService).all()
    return [
        ServiceResponse(
            id=s.id, name=s.name, owner=s.owner,
            environment=s.environment.value, model_name=s.model_name,
            sensitivity_label=s.sensitivity_label.value,
            endpoint_url=s.endpoint_url, is_active=s.is_active,
        )
        for s in services
    ]


@router.get("/{service_id}", response_model=ServiceResponse)
def get_service(
    service_id: int,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    """Get a single service by ID."""
    service = db.query(AIService).filter(AIService.id == service_id).first()
    if not service:
        raise HTTPException(status_code=404, detail="Service not found")
    return ServiceResponse(
        id=service.id, name=service.name, owner=service.owner,
        environment=service.environment.value, model_name=service.model_name,
        sensitivity_label=service.sensitivity_label.value,
        endpoint_url=service.endpoint_url, is_active=service.is_active,
    )


@router.post(
    "/",
    response_model=ServiceResponse,
    dependencies=[Depends(require_role(["admin", "maintainer"]))],
)
def create_service(
    req: ServiceCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Register a new AI service."""
    # Validate enums
    try:
        env = Environment(req.environment)
        sensitivity = SensitivityLabel(req.sensitivity_label)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    service = AIService(
        name=req.name,
        owner=req.owner,
        environment=env,
        model_name=req.model_name,
        sensitivity_label=sensitivity,
        endpoint_url=req.endpoint_url,
    )
    db.add(service)
    db.commit()
    db.refresh(service)

    # Audit log
    log_action(
        db, current_user.id, "create_service", "ai_services",
        service.id, new_value=json.dumps(req.model_dump()),
    )

    return ServiceResponse(
        id=service.id, name=service.name, owner=service.owner,
        environment=service.environment.value, model_name=service.model_name,
        sensitivity_label=service.sensitivity_label.value,
        endpoint_url=service.endpoint_url, is_active=service.is_active,
    )


@router.put(
    "/{service_id}",
    response_model=ServiceResponse,
    dependencies=[Depends(require_role(["admin", "maintainer"]))],
)
def update_service(
    service_id: int,
    req: ServiceUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Update an existing service."""
    service = db.query(AIService).filter(AIService.id == service_id).first()
    if not service:
        raise HTTPException(status_code=404, detail="Service not found")

    old_values = json.dumps({
        "name": service.name, "owner": service.owner,
        "environment": service.environment.value,
    })

    # Apply updates
    update_data = req.model_dump(exclude_unset=True)
    for key, value in update_data.items():
        if key == "environment" and value:
            value = Environment(value)
        elif key == "sensitivity_label" and value:
            value = SensitivityLabel(value)
        setattr(service, key, value)

    db.commit()
    db.refresh(service)

    log_action(
        db, current_user.id, "update_service", "ai_services",
        service.id, old_value=old_values, new_value=json.dumps(update_data),
    )

    return ServiceResponse(
        id=service.id, name=service.name, owner=service.owner,
        environment=service.environment.value, model_name=service.model_name,
        sensitivity_label=service.sensitivity_label.value,
        endpoint_url=service.endpoint_url, is_active=service.is_active,
    )


@router.delete(
    "/{service_id}",
    dependencies=[Depends(require_role(["admin", "maintainer"]))],
)
def delete_service(
    service_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Delete a service from the registry."""
    service = db.query(AIService).filter(AIService.id == service_id).first()
    if not service:
        raise HTTPException(status_code=404, detail="Service not found")

    log_action(
        db, current_user.id, "delete_service", "ai_services",
        service.id, old_value=service.name,
    )

    db.delete(service)
    db.commit()
    return {"detail": "Service deleted", "id": service_id}


@router.post(
    "/{service_id}/test-connection",
    dependencies=[Depends(require_role(["admin", "maintainer"]))],
)
async def test_service_connection(
    service_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Test Connection button — sends a small prompt through the LLM wrapper
    and returns latency + success/fail. Saves result to connection_logs.
    """
    service = db.query(AIService).filter(AIService.id == service_id).first()
    if not service:
        raise HTTPException(status_code=404, detail="Service not found")

    # Call through the REST wrapper — never direct SDK
    result = await llm_test_connection()

    # Save to connection_logs
    log = ConnectionLog(
        service_id=service.id,
        latency_ms=result["latency_ms"],
        status=result["status"],
        response_snippet=result["response_snippet"],
    )
    db.add(log)
    db.commit()

    # Audit
    log_action(
        db, current_user.id, "test_connection", "connection_logs",
        service.id, new_value=f"{result['status']} ({result['latency_ms']}ms)",
    )

    return {
        "service_id": service.id,
        "service_name": service.name,
        **result,
    }
