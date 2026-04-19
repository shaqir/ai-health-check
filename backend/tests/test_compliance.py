"""Tests for the compliance router — audit logs, user management, export."""

from tests.conftest import auth_header
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
