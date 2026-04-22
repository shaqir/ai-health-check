"""
Compliance export + AI report router (Module 4).

- POST /export           → JSON or PDF with audit + incidents + maintenance
- POST /ai-report        → draft LLM compliance report (admin)
- POST /ai-report/{id}/approve → admin approval
- GET  /ai-report/recent → list drafts
"""

import io
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.responses import JSONResponse, StreamingResponse
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.database import get_db
from app.middleware.audit import log_action
from app.middleware.auth import get_current_user
from app.middleware.rbac import require_role
from app.models import AILlmDraft, AuditLog, EvalRun, Incident, MaintenancePlan, User
from app.services.draft_service import approve_draft, create_draft
from app.services.llm_client import generate_compliance_summary


def _iso_utc(value: datetime | None) -> str:
    """Serialize naive-UTC datetime as ISO-8601 with explicit +00:00.
    Matches Dashboard/Incidents/Maintenance convention."""
    if value is None:
        return ""
    return value.replace(tzinfo=timezone.utc).isoformat()

router = APIRouter()

# Raised from 500 after the hostile QA pass flagged compliance evidence
# silently dropping older rows. 10000 keeps a full year of typical audit
# activity in one export. Truncation past this is reported as a warning.
EXPORT_ROW_LIMIT = 10000


def _parse_date_or_400(value: str | None, field_name: str) -> datetime | None:
    """
    Strict ISO-8601 parser for query dates. Returns None if value is empty.
    Raises 400 if value is provided but malformed — previously the parse
    error was silently swallowed, causing "date filter dropped, export
    returned everything" bugs in compliance evidence.
    """
    if not value:
        return None
    try:
        return datetime.fromisoformat(value)
    except ValueError:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                f"Invalid {field_name} '{value}' — use YYYY-MM-DD or ISO-8601. "
                f"Silent date drops would break compliance evidence."
            ),
        )


class ExportRequest(BaseModel):
    format: str = "json"  # "json" or "pdf"
    from_date: str | None = None
    to_date: str | None = None


@router.post(
    "/export",
    dependencies=[Depends(require_role(["admin", "maintainer"]))],
)
def export_compliance_data(
    req: ExportRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    # Strict date parsing — reject malformed dates instead of silently
    # dropping the filter (previous bug: typo in `from_date` returned the
    # entire DB as if no filter was set).
    from_dt = _parse_date_or_400(req.from_date, "from_date")
    to_dt = _parse_date_or_400(req.to_date, "to_date")
    if from_dt and to_dt and from_dt > to_dt:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"from_date ({req.from_date}) must be <= to_date ({req.to_date})",
        )

    warnings: list[str] = []

    # ── Audit log ──
    query = db.query(AuditLog).order_by(AuditLog.timestamp.desc())
    if from_dt:
        query = query.filter(AuditLog.timestamp >= from_dt)
    if to_dt:
        query = query.filter(AuditLog.timestamp <= to_dt)

    audit_total = query.count()
    logs = query.limit(EXPORT_ROW_LIMIT).all()
    if audit_total > EXPORT_ROW_LIMIT:
        warnings.append(
            f"Audit log truncated: showing the {EXPORT_ROW_LIMIT} most recent of "
            f"{audit_total} total rows in the date range. Narrow the range to see older events."
        )
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
            "timestamp": _iso_utc(log.timestamp),
        })

    # ── Incidents (only approved summaries count as official) ──
    inc_query = db.query(Incident).order_by(Incident.created_at.desc())
    if from_dt:
        inc_query = inc_query.filter(Incident.created_at >= from_dt)
    if to_dt:
        inc_query = inc_query.filter(Incident.created_at <= to_dt)
    inc_total = inc_query.count()
    incidents = inc_query.limit(EXPORT_ROW_LIMIT).all()
    if inc_total > EXPORT_ROW_LIMIT:
        warnings.append(
            f"Incidents truncated: {inc_total} in range, "
            f"only {EXPORT_ROW_LIMIT} most recent included."
        )
    incidents_records = [
        {
            "id": i.id,
            "service_id": i.service_id,
            "severity": i.severity.value,
            "status": i.status.value,
            "symptoms": (i.symptoms or "")[:500],
            "summary": i.summary or "",  # drafts excluded
            "root_causes": i.root_causes or "",
            "checklist": {
                "data_issue": i.checklist_data_issue,
                "prompt_change": i.checklist_prompt_change,
                "model_update": i.checklist_model_update,
                "infrastructure": i.checklist_infrastructure,
                "safety_policy": i.checklist_safety_policy,
            },
            "approved_by_user_id": i.approved_by,
            "timeline": _iso_utc(i.timeline),
            "created_at": _iso_utc(i.created_at),
        }
        for i in incidents
    ]

    # ── Maintenance plans ──
    mp_query = db.query(MaintenancePlan).order_by(MaintenancePlan.created_at.desc())
    if from_dt:
        mp_query = mp_query.filter(MaintenancePlan.created_at >= from_dt)
    if to_dt:
        mp_query = mp_query.filter(MaintenancePlan.created_at <= to_dt)
    mp_total = mp_query.count()
    plans = mp_query.limit(EXPORT_ROW_LIMIT).all()
    if mp_total > EXPORT_ROW_LIMIT:
        warnings.append(
            f"Maintenance plans truncated: {mp_total} in range, "
            f"only {EXPORT_ROW_LIMIT} most recent included."
        )
    maintenance_records = [
        {
            "id": p.id,
            "incident_id": p.incident_id,
            "risk_level": p.risk_level.value,
            "rollback_plan": p.rollback_plan,
            "validation_steps": p.validation_steps,
            "approved": p.approved,
            "scheduled_date": _iso_utc(p.scheduled_date),
            "created_at": _iso_utc(p.created_at),
        }
        for p in plans
    ]

    # Audit the export attempt — once we've successfully fetched the rows
    # and before we dispatch on format, so both PDF and JSON paths get a
    # trail. Hostile QA: "who exported the audit log?" — this is the answer.
    log_action(
        db, current_user.id, "export_compliance", "exports", None,
        new_value=(
            f"format={req.format}|audit={len(records)}|incidents={len(incidents_records)}"
            f"|maintenance={len(maintenance_records)}"
            f"|from={req.from_date or ''}|to={req.to_date or ''}"
        ),
    )

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

            elements.append(Paragraph("AI Health Check Compliance Report", styles["Title"]))
            elements.append(Spacer(1, 0.25 * inch))

            if req.from_date or req.to_date:
                date_range = f"Period: {req.from_date or 'start'} to {req.to_date or 'now'}"
                elements.append(Paragraph(date_range, styles["Normal"]))
                elements.append(Spacer(1, 0.15 * inch))

            elements.append(Paragraph(
                f"Audit records: {len(records)} · Incidents: {len(incidents_records)} "
                f"· Maintenance plans: {len(maintenance_records)}",
                styles["Normal"],
            ))
            # Truncation warnings surfaced prominently so a compliance
            # reviewer can't miss that older rows are missing.
            for w in warnings:
                elements.append(Spacer(1, 0.1 * inch))
                elements.append(Paragraph(
                    f"<font color='red'><b>WARNING:</b> {w}</font>",
                    styles["Normal"],
                ))
            elements.append(Spacer(1, 0.25 * inch))

            def _styled_table(data, col_widths):
                t = Table(data, colWidths=col_widths)
                t.setStyle(TableStyle([
                    ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#1e293b")),
                    ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
                    ("FONTSIZE", (0, 0), (-1, -1), 8),
                    ("GRID", (0, 0), (-1, -1), 0.5, colors.grey),
                    ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#f1f5f9")]),
                ]))
                return t

            if records:
                elements.append(Paragraph("Audit Log", styles["Heading2"]))
                audit_table = [["User", "Action", "Target", "Timestamp"]]
                for r in records[:100]:
                    audit_table.append([
                        r["user"][:30], r["action"][:30],
                        r["target"][:30], r["timestamp"][:19],
                    ])
                elements.append(_styled_table(
                    audit_table, [1.5 * inch, 1.5 * inch, 2 * inch, 1.5 * inch]
                ))
                elements.append(Spacer(1, 0.25 * inch))

            if incidents_records:
                elements.append(Paragraph("Incidents", styles["Heading2"]))
                inc_table = [["ID", "Severity", "Status", "Symptoms (preview)"]]
                for i in incidents_records[:60]:
                    inc_table.append([
                        str(i["id"]), i["severity"], i["status"],
                        (i["symptoms"] or "")[:60],
                    ])
                elements.append(_styled_table(
                    inc_table, [0.5 * inch, 1 * inch, 1 * inch, 4 * inch]
                ))
                elements.append(Spacer(1, 0.25 * inch))

            if maintenance_records:
                elements.append(Paragraph("Maintenance Plans", styles["Heading2"]))
                mp_table = [["ID", "Incident", "Risk", "Approved", "Scheduled"]]
                for p in maintenance_records[:60]:
                    mp_table.append([
                        str(p["id"]), str(p["incident_id"]), p["risk_level"],
                        "Yes" if p["approved"] else "No",
                        (p["scheduled_date"] or "")[:19],
                    ])
                elements.append(_styled_table(
                    mp_table, [0.5 * inch, 0.7 * inch, 1 * inch, 0.9 * inch, 1.5 * inch]
                ))

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
        except Exception as exc:
            # Runtime failures inside reportlab (malformed table data,
            # style errors, buffer I/O) previously bubbled up to FastAPI's
            # default 500 handler as `{"detail": "Internal Server Error"}`,
            # telling the operator nothing about where or why. Catch
            # everything the happy path didn't re-raise and surface a
            # clean message naming PDF generation as the source. Message
            # truncated so a runaway exception repr doesn't spam the body.
            raise HTTPException(
                status_code=500,
                detail=f"PDF generation failed: {str(exc)[:200]}",
            )

    return JSONResponse(
        content={
            "records": records,
            "total": len(records),
            "audit_total_in_range": audit_total,
            "incidents": incidents_records,
            "incidents_total_in_range": inc_total,
            "maintenance_plans": maintenance_records,
            "maintenance_total_in_range": mp_total,
            "warnings": warnings,
            "row_limit_per_section": EXPORT_ROW_LIMIT,
        },
        headers={"Content-Disposition": "attachment; filename=compliance_report.json"},
    )


# ── AI Compliance Report with HITL draft/approve ──

@router.post(
    "/ai-report",
    dependencies=[Depends(require_role(["admin"]))],
)
async def generate_ai_compliance_report(
    from_date: str | None = Query(None),
    to_date: str | None = Query(None),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    from_dt = _parse_date_or_400(from_date, "from_date")
    to_dt = _parse_date_or_400(to_date, "to_date")

    query = db.query(AuditLog).order_by(AuditLog.timestamp.desc())
    if from_dt:
        query = query.filter(AuditLog.timestamp >= from_dt)
    if to_dt:
        query = query.filter(AuditLog.timestamp <= to_dt)

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

    result = await generate_compliance_summary(
        audit_data, incidents_data, drift_data,
        user_id=current_user.id,
    )

    surface_ref = f"{from_date or 'start'}_to_{to_date or 'now'}"
    draft = create_draft(
        db,
        surface="compliance_report",
        content=result.get("report_text", ""),
        generated_by_user_id=current_user.id,
        surface_ref=surface_ref,
    )

    log_action(
        db, current_user.id, "generate_ai_report", "ai_llm_drafts", draft.id,
        new_value=f"surface=compliance_report|range={surface_ref}",
    )

    return {
        "draft_id": draft.id,
        "content": draft.content,
        "approved": False,
        "surface": "compliance_report",
    }


@router.post(
    "/ai-report/{draft_id}/approve",
    dependencies=[Depends(require_role(["admin"]))],
)
def approve_ai_report(
    draft_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    draft = approve_draft(db, draft_id, current_user.id)

    log_action(
        db, current_user.id, "approve_ai_report", "ai_llm_drafts", draft.id,
        new_value=f"surface={draft.surface}",
    )

    return {
        "draft_id": draft.id,
        "approved": True,
        "approved_by_user_id": draft.approved_by_user_id,
        "approved_at": draft.approved_at,
    }


@router.get(
    "/ai-report/recent",
    dependencies=[Depends(require_role(["admin"]))],
)
def recent_ai_reports(
    approved_only: bool = Query(True),
    limit: int = Query(10, ge=1, le=50),
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    q = db.query(AILlmDraft).filter(AILlmDraft.surface == "compliance_report")
    if approved_only:
        q = q.filter(AILlmDraft.approved_by_user_id.isnot(None))
    rows = q.order_by(AILlmDraft.id.desc()).limit(limit).all()
    return [
        {
            "draft_id": r.id,
            "content": r.content,
            "approved": r.approved_by_user_id is not None,
            "approved_at": r.approved_at,
            "created_at": r.created_at,
            "surface_ref": r.surface_ref,
        }
        for r in rows
    ]
