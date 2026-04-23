"""
Services router for Module 1: service registry CRUD and connectivity checks.
"""

import json

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, ConfigDict
from sqlalchemy.orm import Session

from app.database import get_db
from app.middleware.audit import log_action
from app.middleware.auth import get_current_user
from app.middleware.rbac import require_role
from app.models import AIService, ConnectionLog, Environment, SensitivityLabel, User
from app.services.llm_client import test_connection as llm_test_connection
from app.services.sensitivity import enforce_sensitivity

router = APIRouter()


class ServiceCreate(BaseModel):
    model_config = ConfigDict(protected_namespaces=())

    name: str
    owner: str
    environment: str
    model_name: str
    sensitivity_label: str


class ServiceUpdate(BaseModel):
    model_config = ConfigDict(protected_namespaces=())

    name: str | None = None
    owner: str | None = None
    environment: str | None = None
    model_name: str | None = None
    sensitivity_label: str | None = None
    is_active: bool | None = None


class ServiceResponse(BaseModel):
    model_config = ConfigDict(
        from_attributes=True,
        protected_namespaces=(),
    )

    id: int
    name: str
    owner: str
    environment: str
    model_name: str
    sensitivity_label: str
    is_active: bool


class ServiceConnectionResponse(BaseModel):
    model_config = ConfigDict(protected_namespaces=())

    service_id: int
    service_name: str
    status: str
    latency_ms: float | None
    response_snippet: str


def _serialize_service(service: AIService) -> ServiceResponse:
    return ServiceResponse(
        id=service.id,
        name=service.name,
        owner=service.owner,
        environment=service.environment.value,
        model_name=service.model_name,
        sensitivity_label=service.sensitivity_label.value,
        is_active=service.is_active,
    )


def _parse_environment(value: str) -> Environment:
    try:
        return Environment(value)
    except ValueError as exc:
        allowed = ", ".join(item.value for item in Environment)
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Invalid environment '{value}'. Allowed values: {allowed}",
        ) from exc


def _parse_sensitivity_label(value: str) -> SensitivityLabel:
    try:
        return SensitivityLabel(value)
    except ValueError as exc:
        allowed = ", ".join(item.value for item in SensitivityLabel)
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                f"Invalid sensitivity_label '{value}'. "
                f"Allowed values: {allowed}"
            ),
        ) from exc


@router.get("", response_model=list[ServiceResponse])
def list_services(
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    services = db.query(AIService).order_by(AIService.id.asc()).all()
    return [_serialize_service(service) for service in services]


@router.get("/{service_id}", response_model=ServiceResponse)
def get_service(
    service_id: int,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    service = db.query(AIService).filter(AIService.id == service_id).first()
    if not service:
        raise HTTPException(status_code=404, detail="Service not found")
    return _serialize_service(service)


@router.post(
    "",
    response_model=ServiceResponse,
    dependencies=[Depends(require_role(["admin", "maintainer"]))],
)
def create_service(
    req: ServiceCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    service = AIService(
        name=req.name,
        owner=req.owner,
        environment=_parse_environment(req.environment),
        model_name=req.model_name,
        sensitivity_label=_parse_sensitivity_label(req.sensitivity_label),
    )
    db.add(service)
    db.commit()
    db.refresh(service)

    log_action(
        db,
        current_user.id,
        "create_service",
        "ai_services",
        service.id,
        new_value=json.dumps(req.model_dump()),
    )

    return _serialize_service(service)


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
    service = db.query(AIService).filter(AIService.id == service_id).first()
    if not service:
        raise HTTPException(status_code=404, detail="Service not found")

    old_values = json.dumps(_serialize_service(service).model_dump())
    update_data = req.model_dump(exclude_unset=True)

    for key, value in update_data.items():
        if key == "environment" and value:
            value = _parse_environment(value)
        elif key == "sensitivity_label" and value:
            value = _parse_sensitivity_label(value)
        setattr(service, key, value)

    db.commit()
    db.refresh(service)

    log_action(
        db,
        current_user.id,
        "update_service",
        "ai_services",
        service.id,
        old_value=old_values,
        new_value=json.dumps(update_data),
    )

    return _serialize_service(service)


@router.delete(
    "/{service_id}",
    dependencies=[Depends(require_role(["admin", "maintainer"]))],
)
def delete_service(
    service_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    service = db.query(AIService).filter(AIService.id == service_id).first()
    if not service:
        raise HTTPException(status_code=404, detail="Service not found")

    # Cache before delete expires the ORM attributes.
    service_name = service.name

    # Snapshot cascaded children BEFORE the delete. AIService has
    # cascade="all, delete-orphan" on incidents, and Incident has the
    # same on maintenance_plans — the ORM will silently sweep both on
    # `db.delete(service)`. Without this snapshot a compliance reviewer
    # asking "who deleted this plan?" gets nothing. Plans are captured
    # before incidents so the emitted audit rows read in tree order
    # (plans -> incidents -> service) which matches the delete order.
    cascaded_plans: list[tuple[int, int]] = []  # (plan_id, incident_id)
    cascaded_incidents: list[int] = []
    for incident in service.incidents:
        cascaded_incidents.append(incident.id)
        for plan in incident.maintenance_plans:
            cascaded_plans.append((plan.id, incident.id))

    db.delete(service)
    db.commit()

    # Emit cascade audit rows first so they carry the original ids of
    # rows that no longer exist. Then the service's own delete_service
    # row caps the tree.
    for plan_id, incident_id in cascaded_plans:
        log_action(
            db,
            current_user.id,
            "cascade_delete_maintenance_plan",
            "maintenance_plans",
            plan_id,
            old_value=f"incident_id={incident_id}",
        )
    for incident_id in cascaded_incidents:
        log_action(
            db,
            current_user.id,
            "cascade_delete_incident",
            "incidents",
            incident_id,
            old_value=f"service_id={service_id}",
        )
    log_action(
        db,
        current_user.id,
        "delete_service",
        "ai_services",
        service_id,
        old_value=service_name,
    )

    return {"detail": "Service deleted", "id": service_id}


@router.post(
    "/{service_id}/test-connection",
    response_model=ServiceConnectionResponse,
    dependencies=[Depends(require_role(["admin", "maintainer"]))],
)
async def test_service_connection(
    service_id: int,
    mode: str = Query("llm", description="Reserved; the backend only runs live LLM pings now."),
    allow_confidential: bool = Query(False, description="Retained for API compatibility; ignored."),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    service = db.query(AIService).filter(AIService.id == service_id).first()
    if not service:
        raise HTTPException(status_code=404, detail="Service not found")

    enforce_sensitivity(db, service, current_user, allow_confidential=allow_confidential)
    result = await llm_test_connection(
        model=service.model_name,
        user_id=current_user.id,
        service_id=service.id,
    )

    log = ConnectionLog(
        service_id=service.id,
        latency_ms=result["latency_ms"],
        status=result["status"],
        response_snippet=result["response_snippet"],
    )
    db.add(log)
    db.commit()
    db.refresh(log)

    audit_detail = f"{result['status']} ({result['latency_ms']}ms)"
    if result["status"] == "failure" and result.get("response_snippet"):
        audit_detail = f"{audit_detail} — {result['response_snippet'][:160]}"

    log_action(
        db,
        current_user.id,
        "test_connection",
        "connection_logs",
        log.id,
        new_value=audit_detail,
    )

    return ServiceConnectionResponse(
        service_id=service.id,
        service_name=service.name,
        **result,
    )
