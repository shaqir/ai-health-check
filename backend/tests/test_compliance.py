"""Tests for the compliance router — audit logs, user management, export."""

from tests.conftest import auth_header, engine
from app.models import AuditLog, User, UserRole
from app.middleware.auth import hash_password


def test_list_audit_logs_empty(client, db, admin_token):
    res = client.get("/api/v1/compliance/audit-log", headers=auth_header(admin_token))
    assert res.status_code == 200
    assert res.json() == []


def test_list_audit_logs(client, db, admin_token, admin_user):
    db.add(AuditLog(
        user_id=admin_user.id, action="create_service",
        target_table="ai_services", target_id=1,
        new_value="test service",
    ))
    db.commit()

    res = client.get("/api/v1/compliance/audit-log", headers=auth_header(admin_token))
    assert res.status_code == 200
    data = res.json()
    assert len(data) == 1
    assert data[0]["action"] == "create_service"
    assert data[0]["user_email"] == "admin@test.local"


def test_list_users_admin(client, db, admin_token, admin_user):
    res = client.get("/api/v1/compliance/users", headers=auth_header(admin_token))
    assert res.status_code == 200
    data = res.json()
    assert len(data) >= 1
    assert any(u["email"] == "admin@test.local" for u in data)


def test_list_users_viewer_forbidden(client, db, viewer_token):
    res = client.get("/api/v1/compliance/users", headers=auth_header(viewer_token))
    assert res.status_code == 403


def test_update_user_role(client, db, admin_token, admin_user):
    target = User(
        username="target", email="target@test.local",
        password_hash=hash_password("pass"), role=UserRole.viewer,
    )
    db.add(target)
    db.commit()
    db.refresh(target)

    res = client.put(
        f"/api/v1/compliance/users/{target.id}/role",
        json={"role": "maintainer"},
        headers=auth_header(admin_token),
    )
    assert res.status_code == 200
    assert "maintainer" in res.json()["detail"]


def test_cannot_change_own_role(client, db, admin_token, admin_user):
    res = client.put(
        f"/api/v1/compliance/users/{admin_user.id}/role",
        json={"role": "viewer"},
        headers=auth_header(admin_token),
    )
    assert res.status_code == 400
    assert "own role" in res.json()["detail"].lower()


def test_update_user_role_invalid(client, db, admin_token, admin_user):
    target = User(
        username="target2", email="target2@test.local",
        password_hash=hash_password("pass"), role=UserRole.viewer,
    )
    db.add(target)
    db.commit()
    db.refresh(target)

    res = client.put(
        f"/api/v1/compliance/users/{target.id}/role",
        json={"role": "superadmin"},
        headers=auth_header(admin_token),
    )
    assert res.status_code == 400


def test_export_json(client, db, admin_token, admin_user):
    db.add(AuditLog(
        user_id=admin_user.id, action="test_action",
        target_table="test", target_id=1,
    ))
    db.commit()

    res = client.post("/api/v1/compliance/export", json={
        "format": "json",
    }, headers=auth_header(admin_token))
    assert res.status_code == 200
    data = res.json()
    assert "records" in data
    assert data["total"] >= 1


def test_unauthenticated_audit_log(client):
    res = client.get("/api/v1/compliance/audit-log")
    assert res.status_code == 401


def test_viewer_cannot_export(client, db, viewer_token):
    res = client.post("/api/v1/compliance/export", json={
        "format": "json",
    }, headers=auth_header(viewer_token))
    assert res.status_code == 403


def test_audit_log_denies_viewer(client, db, viewer_token):
    """Viewer must NOT be able to read the full audit log — sensitive governance data."""
    res = client.get("/api/v1/compliance/audit-log", headers=auth_header(viewer_token))
    assert res.status_code == 403


def test_audit_log_denies_maintainer(client, db, maintainer_token):
    """Audit log is admin-only. Maintainer should be rejected even though they can mutate data."""
    res = client.get("/api/v1/compliance/audit-log", headers=auth_header(maintainer_token))
    assert res.status_code == 403


def test_role_denied_events_audited(client, db, viewer_token, viewer_user):
    """Every 403 from the RBAC decorator must leave a trail in the audit log."""
    # Attempt a denied action
    res = client.get("/api/v1/compliance/users", headers=auth_header(viewer_token))
    assert res.status_code == 403

    # Confirm the denial was recorded
    logs = db.query(AuditLog).filter(AuditLog.action == "role_denied").all()
    assert len(logs) == 1
    assert logs[0].user_id == viewer_user.id
    assert logs[0].old_value == "viewer"
    assert "admin" in logs[0].new_value


def test_audit_log_hash_chain_walks_intact(client, db, admin_token, admin_user):
    """Every log_action call builds a linked hash chain; verify returns valid."""
    from app.middleware.audit import log_action

    log_action(db, admin_user.id, "act1", "t", 1, new_value="a")
    log_action(db, admin_user.id, "act2", "t", 2, new_value="b")
    log_action(db, admin_user.id, "act3", "t", 3, new_value="c")

    res = client.get(
        "/api/v1/compliance/audit-log/verify",
        headers=auth_header(admin_token),
    )
    assert res.status_code == 200
    body = res.json()
    assert body["total"] == 3
    assert body["valid"] is True
    assert body["broken_at"] is None


def test_audit_log_tamper_detected(client, db, admin_token, admin_user):
    """Bypassing the ORM to mutate a past row must be detected by verify."""
    from sqlalchemy import text
    from app.middleware.audit import log_action

    log_action(db, admin_user.id, "original_action", "t", 1, new_value="clean")
    log_action(db, admin_user.id, "next_action", "t", 2, new_value="ok")

    # Tamper: drop triggers temporarily (simulating a direct DB breach),
    # modify row 1's action, and restore triggers.
    with engine.begin() as conn:
        conn.execute(text("DROP TRIGGER IF EXISTS audit_log_no_update"))
        conn.execute(text(
            "UPDATE audit_log SET action = 'tampered' WHERE id = 1"
        ))
        conn.execute(text("""
            CREATE TRIGGER IF NOT EXISTS audit_log_no_update
            BEFORE UPDATE ON audit_log
            BEGIN
                SELECT RAISE(ABORT, 'audit_log is append-only: UPDATE blocked');
            END
        """))

    res = client.get(
        "/api/v1/compliance/audit-log/verify",
        headers=auth_header(admin_token),
    )
    body = res.json()
    assert body["valid"] is False
    assert body["broken_at"] == 1
    assert "content_hash" in body["reason"]


def test_audit_log_trigger_blocks_direct_update(client, db, admin_user):
    """The SQLite trigger rejects any attempt to UPDATE audit_log via the app path."""
    from sqlalchemy.exc import SQLAlchemyError
    from app.middleware.audit import log_action

    log_action(db, admin_user.id, "original", "t", 1, new_value="x")
    entry = db.query(AuditLog).first()

    entry.action = "forged"
    try:
        db.commit()
        raise AssertionError("UPDATE should have been blocked by the trigger")
    except SQLAlchemyError as exc:
        assert "append-only" in str(exc).lower()
        db.rollback()


def test_audit_log_verify_denies_non_admin(client, db, viewer_token, maintainer_token):
    """Verify endpoint is admin-only."""
    assert client.get(
        "/api/v1/compliance/audit-log/verify",
        headers=auth_header(viewer_token),
    ).status_code == 403
    assert client.get(
        "/api/v1/compliance/audit-log/verify",
        headers=auth_header(maintainer_token),
    ).status_code == 403


# ── Compliance export — incidents + maintenance coverage ──

def test_export_json_contains_incidents_and_maintenance(client, db, admin_token, admin_user):
    """Export must include incidents[] and maintenance_plans[] arrays, not just audit records."""
    from app.models import (
        AIService, Environment, SensitivityLabel,
        Incident, Severity, IncidentStatus, MaintenancePlan,
    )

    svc = AIService(
        name="S1", owner="T", environment=Environment.prod,
        model_name="m", sensitivity_label=SensitivityLabel.internal,
    )
    db.add(svc)
    db.commit()
    db.refresh(svc)

    inc = Incident(
        service_id=svc.id, severity=Severity.high,
        symptoms="latency spike", status=IncidentStatus.open,
    )
    db.add(inc)
    db.commit()
    db.refresh(inc)

    plan = MaintenancePlan(
        incident_id=inc.id, risk_level=Severity.medium,
        rollback_plan="revert deploy", validation_steps="run smoke tests",
    )
    db.add(plan)
    db.commit()

    res = client.post(
        "/api/v1/compliance/export",
        json={"format": "json"},
        headers=auth_header(admin_token),
    )
    assert res.status_code == 200
    body = res.json()
    assert "incidents" in body
    assert "maintenance_plans" in body
    assert len(body["incidents"]) == 1
    assert body["incidents"][0]["severity"] == "high"
    assert len(body["maintenance_plans"]) == 1
    assert body["maintenance_plans"][0]["risk_level"] == "medium"


def test_export_omits_unapproved_incident_summaries(client, db, admin_token):
    """Only approved incident summaries should appear in the export. Drafts are excluded."""
    from app.models import (
        AIService, Environment, SensitivityLabel,
        Incident, Severity, IncidentStatus,
    )

    svc = AIService(
        name="S", owner="T", environment=Environment.prod,
        model_name="m", sensitivity_label=SensitivityLabel.internal,
    )
    db.add(svc)
    db.commit()
    db.refresh(svc)

    inc = Incident(
        service_id=svc.id, severity=Severity.low, symptoms="x",
        status=IncidentStatus.open,
        summary="",  # never approved
        summary_draft="AI-drafted summary (not approved)",
    )
    db.add(inc)
    db.commit()

    res = client.post(
        "/api/v1/compliance/export",
        json={"format": "json"},
        headers=auth_header(admin_token),
    )
    body = res.json()
    assert body["incidents"][0]["summary"] == ""


def test_export_pdf_renders_with_sections(client, db, admin_token):
    """Smoke test: PDF mode returns non-empty bytes with all sections present."""
    from app.models import (
        AIService, Environment, SensitivityLabel,
        Incident, Severity, IncidentStatus, MaintenancePlan, AuditLog,
    )

    # Seed all three kinds of records
    svc = AIService(
        name="S", owner="T", environment=Environment.prod,
        model_name="m", sensitivity_label=SensitivityLabel.internal,
    )
    db.add(svc)
    db.commit()
    db.refresh(svc)

    from app.middleware.audit import log_action
    log_action(db, None, "test_action", "ai_services", svc.id)

    inc = Incident(service_id=svc.id, severity=Severity.low, symptoms="s")
    db.add(inc)
    db.commit()
    db.refresh(inc)

    db.add(MaintenancePlan(
        incident_id=inc.id, risk_level=Severity.low,
        rollback_plan="r", validation_steps="v",
    ))
    db.commit()

    res = client.post(
        "/api/v1/compliance/export",
        json={"format": "pdf"},
        headers=auth_header(admin_token),
    )
    assert res.status_code == 200
    # Non-trivial byte length means the new sections rendered
    assert len(res.content) > 2000
    assert res.headers["content-type"] == "application/pdf"
