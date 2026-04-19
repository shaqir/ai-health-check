"""
Audit log router (Module 4). Admin-only.
"""

from datetime import datetime

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.database import get_db
from app.middleware.audit import verify_audit_chain
from app.middleware.auth import get_current_user
from app.middleware.rbac import require_role
from app.models import AuditLog, User

router = APIRouter()


class AuditLogResponse(BaseModel):
    id: int
    user_id: int | None
    user_email: str
    action: str
    target_table: str
    target_id: int | None
    old_value: str
    new_value: str
    timestamp: datetime | None


@router.get(
    "/audit-log",
    response_model=list[AuditLogResponse],
    dependencies=[Depends(require_role(["admin"]))],
)
def list_audit_logs(
    from_date: str | None = Query(None),
    to_date: str | None = Query(None),
    action: str | None = Query(None),
    limit: int = Query(50, ge=1, le=200),
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    query = db.query(AuditLog).order_by(AuditLog.timestamp.desc())

    if from_date:
        try:
            dt = datetime.fromisoformat(from_date)
            query = query.filter(AuditLog.timestamp >= dt)
        except ValueError:
            pass

    if to_date:
        try:
            dt = datetime.fromisoformat(to_date)
            query = query.filter(AuditLog.timestamp <= dt)
        except ValueError:
            pass

    if action:
        query = query.filter(AuditLog.action == action)

    logs = query.limit(limit).all()

    result = []
    for log in logs:
        user = db.query(User).filter(User.id == log.user_id).first() if log.user_id else None
        result.append(AuditLogResponse(
            id=log.id,
            user_id=log.user_id,
            user_email=user.email if user else "system",
            action=log.action,
            target_table=log.target_table,
            target_id=log.target_id,
            old_value=log.old_value or "",
            new_value=log.new_value or "",
            timestamp=log.timestamp,
        ))

    return result


@router.get(
    "/audit-log/verify",
    dependencies=[Depends(require_role(["admin"]))],
)
def verify_audit_log(
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    """Walk the hash chain and report integrity."""
    return verify_audit_chain(db)
