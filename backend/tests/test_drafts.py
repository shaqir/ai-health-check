"""
Tests for the HITL draft/approve flow on dashboard AI insights and
compliance AI reports. Closes the audit finding that these two surfaces
bypassed human approval.
"""

from unittest.mock import AsyncMock, patch

from tests.conftest import auth_header
from app.models import AILlmDraft, AuditLog


# ── Dashboard AI insight ──

@patch("app.routers.dashboard.generate_dashboard_insight", new_callable=AsyncMock)
def test_ai_summary_creates_unapproved_draft(mock_insight, client, db, admin_token, admin_user):
    """POST /dashboard/ai-summary now returns a draft_id and approved=False."""
    mock_insight.return_value = {"insight_text": "Platform looks healthy."}

    res = client.post("/api/v1/dashboard/ai-summary", headers=auth_header(admin_token))
    assert res.status_code == 200
    body = res.json()
    assert body["approved"] is False
    assert body["draft_id"] > 0
    assert body["content"] == "Platform looks healthy."

    draft = db.query(AILlmDraft).filter(AILlmDraft.id == body["draft_id"]).first()
    assert draft is not None
    assert draft.surface == "dashboard_insight"
    assert draft.approved_by_user_id is None


@patch("app.routers.dashboard.generate_dashboard_insight", new_callable=AsyncMock)
def test_ai_summary_approval_flips_fields(mock_insight, client, db, admin_token, admin_user):
    mock_insight.return_value = {"insight_text": "Looks good."}

    gen = client.post("/api/v1/dashboard/ai-summary", headers=auth_header(admin_token))
    draft_id = gen.json()["draft_id"]

    res = client.post(
        f"/api/v1/dashboard/ai-summary/{draft_id}/approve",
        headers=auth_header(admin_token),
    )
    assert res.status_code == 200
    assert res.json()["approved"] is True

    draft = db.query(AILlmDraft).filter(AILlmDraft.id == draft_id).first()
    assert draft.approved_by_user_id == admin_user.id
    assert draft.approved_at is not None

    # Approval event must be audited
    audit = db.query(AuditLog).filter(AuditLog.action == "llm_draft_approved").all()
    assert len(audit) == 1


@patch("app.routers.dashboard.generate_dashboard_insight", new_callable=AsyncMock)
def test_ai_summary_viewer_cannot_approve(mock_insight, client, db, admin_token, viewer_token):
    mock_insight.return_value = {"insight_text": "x"}

    gen = client.post("/api/v1/dashboard/ai-summary", headers=auth_header(admin_token))
    draft_id = gen.json()["draft_id"]

    res = client.post(
        f"/api/v1/dashboard/ai-summary/{draft_id}/approve",
        headers=auth_header(viewer_token),
    )
    assert res.status_code == 403


@patch("app.routers.dashboard.generate_dashboard_insight", new_callable=AsyncMock)
def test_ai_summary_double_approve_rejected(mock_insight, client, db, admin_token):
    mock_insight.return_value = {"insight_text": "x"}

    gen = client.post("/api/v1/dashboard/ai-summary", headers=auth_header(admin_token))
    draft_id = gen.json()["draft_id"]

    first = client.post(
        f"/api/v1/dashboard/ai-summary/{draft_id}/approve",
        headers=auth_header(admin_token),
    )
    assert first.status_code == 200

    second = client.post(
        f"/api/v1/dashboard/ai-summary/{draft_id}/approve",
        headers=auth_header(admin_token),
    )
    assert second.status_code == 409


# ── Compliance AI report ──

@patch("app.routers.export.generate_compliance_summary", new_callable=AsyncMock)
def test_ai_report_creates_unapproved_draft(mock_report, client, db, admin_token, admin_user):
    mock_report.return_value = {"report_text": "Compliance looks fine."}

    res = client.post("/api/v1/compliance/ai-report", headers=auth_header(admin_token))
    assert res.status_code == 200
    body = res.json()
    assert body["approved"] is False
    assert body["surface"] == "compliance_report"

    draft = db.query(AILlmDraft).filter(AILlmDraft.id == body["draft_id"]).first()
    assert draft.approved_by_user_id is None


@patch("app.routers.export.generate_compliance_summary", new_callable=AsyncMock)
def test_ai_report_approval_requires_admin(mock_report, client, db, admin_token, maintainer_token):
    mock_report.return_value = {"report_text": "x"}

    # Maintainer can't even generate it (admin-only)
    gen_m = client.post("/api/v1/compliance/ai-report", headers=auth_header(maintainer_token))
    assert gen_m.status_code == 403

    # Admin generates
    gen = client.post("/api/v1/compliance/ai-report", headers=auth_header(admin_token))
    draft_id = gen.json()["draft_id"]

    # Maintainer cannot approve
    res = client.post(
        f"/api/v1/compliance/ai-report/{draft_id}/approve",
        headers=auth_header(maintainer_token),
    )
    assert res.status_code == 403

    # Admin can approve
    res = client.post(
        f"/api/v1/compliance/ai-report/{draft_id}/approve",
        headers=auth_header(admin_token),
    )
    assert res.status_code == 200


@patch("app.routers.export.generate_compliance_summary", new_callable=AsyncMock)
def test_recent_ai_reports_filters_by_approval(mock_report, client, db, admin_token):
    mock_report.return_value = {"report_text": "x"}

    # Generate two drafts, approve only the first
    d1 = client.post("/api/v1/compliance/ai-report", headers=auth_header(admin_token)).json()
    d2 = client.post("/api/v1/compliance/ai-report", headers=auth_header(admin_token)).json()
    client.post(
        f"/api/v1/compliance/ai-report/{d1['draft_id']}/approve",
        headers=auth_header(admin_token),
    )

    approved = client.get(
        "/api/v1/compliance/ai-report/recent?approved_only=true",
        headers=auth_header(admin_token),
    ).json()
    all_ = client.get(
        "/api/v1/compliance/ai-report/recent?approved_only=false",
        headers=auth_header(admin_token),
    ).json()

    assert len(approved) == 1
    assert approved[0]["draft_id"] == d1["draft_id"]
    assert len(all_) == 2
