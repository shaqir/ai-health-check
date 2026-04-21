"""
Unit tests for the shared draft service. Proves the HITL contract holds
independent of any specific router calling into it.
"""

import pytest
from fastapi import HTTPException

from app.models import AILlmDraft, AuditLog
from app.services.draft_service import approve_draft, create_draft


def test_create_draft_persists_unapproved(db, admin_user):
    draft = create_draft(
        db,
        surface="dashboard_insight",
        content="Platform looks fine.",
        generated_by_user_id=admin_user.id,
    )
    assert draft.id > 0
    assert draft.approved_by_user_id is None
    assert draft.approved_at is None
    assert draft.surface == "dashboard_insight"


def test_create_draft_audits(db, admin_user):
    create_draft(
        db, surface="compliance_report", content="x",
        generated_by_user_id=admin_user.id,
    )
    logs = db.query(AuditLog).filter(AuditLog.action == "llm_draft_created").all()
    assert len(logs) == 1


def test_approve_draft_flips_fields(db, admin_user):
    draft = create_draft(
        db, surface="dashboard_insight", content="x",
        generated_by_user_id=admin_user.id,
    )
    approved = approve_draft(db, draft.id, admin_user.id)
    assert approved.approved_by_user_id == admin_user.id
    assert approved.approved_at is not None

    audits = db.query(AuditLog).filter(AuditLog.action == "llm_draft_approved").all()
    assert len(audits) == 1


def test_approve_draft_rejects_second_approval(db, admin_user):
    draft = create_draft(
        db, surface="dashboard_insight", content="x",
        generated_by_user_id=admin_user.id,
    )
    approve_draft(db, draft.id, admin_user.id)

    with pytest.raises(HTTPException) as exc:
        approve_draft(db, draft.id, admin_user.id)
    assert exc.value.status_code == 409


def test_approve_draft_404_on_missing(db, admin_user):
    with pytest.raises(HTTPException) as exc:
        approve_draft(db, 9999, admin_user.id)
    assert exc.value.status_code == 404
