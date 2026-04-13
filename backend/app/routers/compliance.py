"""
Compliance router for Module 4: audit log retrieval, user management, export, and AI reports.
"""

import io
import json
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.responses import JSONResponse, StreamingResponse
from pydantic import BaseModel, ConfigDict
from sqlalchemy.orm import Session

from app.database import get_db
from app.middleware.audit import log_action
from app.middleware.auth import get_current_user
from app.middleware.rbac import require_role
from app.models import AuditLog, EvalRun, Incident, User, UserRole
from app.services.llm_client import generate_compliance_summary

router = APIRouter()


# ── Schemas ──

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


class UserResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    username: str
    email: str
    role: str
    is_active: bool
    created_at: datetime | None = None


class UserRoleUpdate(BaseModel):
    role: str


class ExportRequest(BaseModel):
    format: str = "json"  # "json" or "pdf"
    from_date: str | None = None
    to_date: str | None = None


# ── Audit Log ──

@router.get("/audit-log", response_model=list[AuditLogResponse])
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


# ── User Management ──

@router.get(
    "/users",
    response_model=list[UserResponse],
    dependencies=[Depends(require_role(["admin"]))],
)
def list_users(
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    users = db.query(User).order_by(User.id.asc()).all()
    return [
        UserResponse(
            id=u.id,
            username=u.username,
            email=u.email,
            role=u.role.value,
            is_active=u.is_active,
            created_at=u.created_at,
        )
        for u in users
    ]


@router.put(
    "/users/{user_id}/role",
    dependencies=[Depends(require_role(["admin"]))],
)
def update_user_role(
    user_id: int,
    req: UserRoleUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if current_user.id == user_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Cannot change your own role",
        )

    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    try:
        new_role = UserRole(req.role)
    except ValueError:
        allowed = ", ".join(r.value for r in UserRole)
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Invalid role '{req.role}'. Allowed: {allowed}",
        )

    old_role = user.role.value
    user.role = new_role
    db.commit()
    db.refresh(user)

    log_action(
        db, current_user.id, "update_user_role", "users",
        user.id, old_value=old_role, new_value=new_role.value,
    )

    return {"detail": f"User role updated to {new_role.value}", "user_id": user_id}


# ── Export ──

@router.post(
    "/export",
    dependencies=[Depends(require_role(["admin", "maintainer"]))],
)
def export_compliance_data(
    req: ExportRequest,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    query = db.query(AuditLog).order_by(AuditLog.timestamp.desc())

    if req.from_date:
        try:
            dt = datetime.fromisoformat(req.from_date)
            query = query.filter(AuditLog.timestamp >= dt)
        except ValueError:
            pass

    if req.to_date:
        try:
            dt = datetime.fromisoformat(req.to_date)
            query = query.filter(AuditLog.timestamp <= dt)
        except ValueError:
            pass

    logs = query.limit(500).all()

    records = []
    for log in logs:
        user = db.query(User).filter(User.id == log.user_id).first() if log.user_id else None
        records.append({
            "id": log.id,
            "user": user.email if user else "system",
            "action": log.action,
            "target": f"{log.target_table}#{log.target_id}",
            "old_value": log.old_value or "",
            "new_value": log.new_value or "",
            "timestamp": log.timestamp.isoformat() if log.timestamp else "",
        })

    if req.format == "pdf":
        try:
            from reportlab.lib.pagesizes import letter
            from reportlab.lib.units import inch
            from reportlab.platypus import SimpleDocTemplate, Table, TableStyle, Paragraph, Spacer
            from reportlab.lib.styles import getSampleStyleSheet
            from reportlab.lib import colors

            buffer = io.BytesIO()
            doc = SimpleDocTemplate(buffer, pagesize=letter)
            styles = getSampleStyleSheet()
            elements = []

            elements.append(Paragraph("AIHealthCheck Compliance Report", styles["Title"]))
            elements.append(Spacer(1, 0.25 * inch))

            if req.from_date or req.to_date:
                date_range = f"Period: {req.from_date or 'start'} to {req.to_date or 'now'}"
                elements.append(Paragraph(date_range, styles["Normal"]))
                elements.append(Spacer(1, 0.15 * inch))

            elements.append(Paragraph(f"Total Records: {len(records)}", styles["Normal"]))
            elements.append(Spacer(1, 0.25 * inch))

            if records:
                table_data = [["User", "Action", "Target", "Timestamp"]]
                for r in records[:100]:
                    table_data.append([
                        r["user"][:30],
                        r["action"][:30],
                        r["target"][:30],
                        r["timestamp"][:19],
                    ])

                table = Table(table_data, colWidths=[1.5 * inch, 1.5 * inch, 2 * inch, 1.5 * inch])
                table.setStyle(TableStyle([
                    ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#1e293b")),
                    ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
                    ("FONTSIZE", (0, 0), (-1, -1), 8),
                    ("GRID", (0, 0), (-1, -1), 0.5, colors.grey),
                    ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#f1f5f9")]),
                ]))
                elements.append(table)

            doc.build(elements)
            buffer.seek(0)

            return StreamingResponse(
                buffer,
                media_type="application/pdf",
                headers={"Content-Disposition": "attachment; filename=compliance_report.pdf"},
            )
        except ImportError:
            raise HTTPException(
                status_code=500,
                detail="PDF generation unavailable — reportlab not installed",
            )

    # Default: JSON export
    return JSONResponse(
        content={"records": records, "total": len(records)},
        headers={"Content-Disposition": "attachment; filename=compliance_report.json"},
    )


# ── AI Compliance Report ──

@router.post(
    "/ai-report",
    dependencies=[Depends(require_role(["admin"]))],
)
async def generate_ai_compliance_report(
    from_date: str | None = Query(None),
    to_date: str | None = Query(None),
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    query = db.query(AuditLog).order_by(AuditLog.timestamp.desc())
    if from_date:
        try:
            query = query.filter(AuditLog.timestamp >= datetime.fromisoformat(from_date))
        except ValueError:
            pass
    if to_date:
        try:
            query = query.filter(AuditLog.timestamp <= datetime.fromisoformat(to_date))
        except ValueError:
            pass

    logs = query.limit(50).all()
    audit_data = [
        {"action": l.action, "target": f"{l.target_table}#{l.target_id}", "timestamp": str(l.timestamp)}
        for l in logs
    ]

    incidents = db.query(Incident).order_by(Incident.created_at.desc()).limit(20).all()
    incidents_data = [
        {"severity": i.severity.value, "symptoms": i.symptoms[:100], "status": i.status.value}
        for i in incidents
    ]

    drift_runs = db.query(EvalRun).filter(EvalRun.drift_flagged == True).limit(10).all()
    drift_data = [
        {"service_id": r.service_id, "score": r.quality_score, "run_at": str(r.run_at)}
        for r in drift_runs
    ]

    result = await generate_compliance_summary(audit_data, incidents_data, drift_data)
    return result
