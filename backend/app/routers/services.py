"""
Services router for Module 1: service registry CRUD and connectivity checks.
"""

import json
import time
from urllib.parse import urlparse

import httpx
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
from app.services.url_validator import UnsafeUrlError, validate_outbound_url

router = APIRouter()


class ServiceCreate(BaseModel):
    model_config = ConfigDict(protected_namespaces=())

    name: str
    owner: str
    environment: str
    model_name: str
    sensitivity_label: str
    endpoint_url: str = ""


class ServiceUpdate(BaseModel):
    model_config = ConfigDict(protected_namespaces=())

    name: str | None = None
    owner: str | None = None
    environment: str | None = None
    model_name: str | None = None
    sensitivity_label: str | None = None
    endpoint_url: str | None = None
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
    endpoint_url: str
    is_active: bool


class ServiceConnectionResponse(BaseModel):
    model_config = ConfigDict(protected_namespaces=())

    service_id: int
    service_name: str
    endpoint_url: str
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
        endpoint_url=service.endpoint_url,
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


async def _probe_service_endpoint(endpoint_url: str) -> dict:
    # Re-validate at probe time too. Closes the DNS-rebinding window where
    # an endpoint passed validation at registration but now resolves to a
    # private IP. Also catches anyone who bypassed the API to edit the DB.
    try:
        validate_outbound_url(endpoint_url)
    except UnsafeUrlError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Unsafe endpoint URL: {exc}",
        )

    start = time.perf_counter()

    try:
        async with httpx.AsyncClient(timeout=10.0, follow_redirects=True) as client:
            response = await client.get(endpoint_url)
        latency_ms = round((time.perf_counter() - start) * 1000, 1)
        snippet = (response.text or "")[:200]
        return {
            "status": "success" if response.is_success else "failure",
            "latency_ms": latency_ms,
            "response_snippet": (
                snippet or f"HTTP {response.status_code} from service endpoint"
            ),
        }
    except httpx.HTTPError as exc:
        latency_ms = round((time.perf_counter() - start) * 1000, 1)
        return {
            "status": "failure",
            "latency_ms": latency_ms,
            "response_snippet": str(exc)[:200],
        }


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
    endpoint_url = req.endpoint_url.strip()
    if endpoint_url:
        try:
            validate_outbound_url(endpoint_url)
        except UnsafeUrlError as exc:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Unsafe endpoint URL: {exc}",
            )
    service = AIService(
        name=req.name,
        owner=req.owner,
        environment=_parse_environment(req.environment),
        model_name=req.model_name,
        sensitivity_label=_parse_sensitivity_label(req.sensitivity_label),
        endpoint_url=endpoint_url,
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
        elif key == "endpoint_url" and value is not None:
            value = value.strip()
            if value:
                try:
                    validate_outbound_url(value)
                except UnsafeUrlError as exc:
                    raise HTTPException(
                        status_code=status.HTTP_400_BAD_REQUEST,
                        detail=f"Unsafe endpoint URL: {exc}",
                    )
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

    log_action(
        db,
        current_user.id,
        "delete_service",
        "ai_services",
        service.id,
        old_value=service.name,
    )

    db.delete(service)
    db.commit()
    return {"detail": "Service deleted", "id": service_id}


@router.post(
    "/{service_id}/test-connection",
    response_model=ServiceConnectionResponse,
    dependencies=[Depends(require_role(["admin", "maintainer"]))],
)
async def test_service_connection(
    service_id: int,
    mode: str = Query("http", description="Test mode: 'http' for endpoint probe, 'llm' for Claude API health check"),
    allow_confidential: bool = Query(False, description="Admin override to allow LLM for confidential services"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    service = db.query(AIService).filter(AIService.id == service_id).first()
    if not service:
        raise HTTPException(status_code=404, detail="Service not found")

    if mode == "llm":
        enforce_sensitivity(db, service, current_user, allow_confidential=allow_confidential)
        result = await llm_test_connection(model=service.model_name)
    else:
        if not service.endpoint_url:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Service has no endpoint_url configured",
            )
        result = await _probe_service_endpoint(service.endpoint_url)

    log = ConnectionLog(
        service_id=service.id,
        latency_ms=result["latency_ms"],
        status=result["status"],
        response_snippet=result["response_snippet"],
    )
    db.add(log)
    db.commit()
    db.refresh(log)

    log_action(
        db,
        current_user.id,
        "test_connection",
        "connection_logs",
        log.id,
        new_value=f"{result['status']} ({result['latency_ms']}ms)",
    )

    return ServiceConnectionResponse(
        service_id=service.id,
        service_name=service.name,
        endpoint_url=service.endpoint_url,
        **result,
    )
