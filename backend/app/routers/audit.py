"""
Audit log router (Module 4). Admin-only.
"""

from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, status
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
    # ISO-8601 with explicit +00:00 — SQLite drops tzinfo on write but every
    # app write path uses utcnow(), so re-attaching UTC is always correct.
    timestamp: str | None


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
    # Strict date parsing — silently dropping a malformed filter would
    # give reviewers the wrong answer.
    def _parse(value: str | None, field: str):
        if not value:
            return None
        try:
            return datetime.fromisoformat(value)
        except ValueError:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Invalid {field} '{value}' — use YYYY-MM-DD or ISO-8601",
            )

    from_dt = _parse(from_date, "from_date")
    to_dt = _parse(to_date, "to_date")

    query = db.query(AuditLog).order_by(AuditLog.timestamp.desc())
    if from_dt:
        query = query.filter(AuditLog.timestamp >= from_dt)
    if to_dt:
        query = query.filter(AuditLog.timestamp <= to_dt)

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
            timestamp=log.timestamp.replace(tzinfo=timezone.utc).isoformat() if log.timestamp else None,
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
