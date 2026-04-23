"""
Tests for auth router — login audit mirror + lockout trail.

These go beyond login_success/failure rate-limiting (already exercised in
test_services.py). Here we prove every auth event also lands in the
authoritative audit log so governance review has a single trail.
"""

from tests.conftest import auth_header
from app.models import AuditLog, LoginAttempt


def test_login_success_audited(client, admin_user, db):
    """A successful login must write login_success to the audit log."""
    res = client.post(
        "/api/v1/auth/login",
        data={"username": "admin@test.local", "password": "admin123"},
    )
    assert res.status_code == 200

    logs = db.query(AuditLog).filter(AuditLog.action == "login_success").all()
    assert len(logs) == 1
    assert logs[0].user_id == admin_user.id
    assert logs[0].target_table == "users"


def test_login_failed_audited(client, admin_user, db):
    """Failed login must write login_failed to the audit log."""
    res = client.post(
        "/api/v1/auth/login",
        data={"username": "admin@test.local", "password": "wrong"},
    )
    assert res.status_code == 401

    logs = db.query(AuditLog).filter(AuditLog.action == "login_failed").all()
    assert len(logs) == 1
    # user_id is None — don't leak which accounts exist
    assert logs[0].user_id is None
    assert "admin@test.local" in logs[0].new_value


def test_login_lockout_audited(client, admin_user, db):
    """After max_login_attempts failures, the lockout itself is audited."""
    # Trigger 5 failed attempts — the configured max_login_attempts
    for _ in range(5):
        client.post(
            "/api/v1/auth/login",
            data={"username": "admin@test.local", "password": "wrong"},
        )

    # The 6th attempt should be throttled with a lockout audit entry
    res = client.post(
        "/api/v1/auth/login",
        data={"username": "admin@test.local", "password": "wrong"},
    )
    assert res.status_code == 429

    lockout_logs = db.query(AuditLog).filter(AuditLog.action == "login_lockout").all()
    assert len(lockout_logs) >= 1
    assert "admin@test.local" in lockout_logs[0].new_value


def test_login_audit_and_throttle_table_are_both_populated(client, admin_user, db):
    """
    Regression guard: both sources of truth must stay in sync.
    LoginAttempt table powers throttle math; AuditLog powers governance.
    """
    client.post(
        "/api/v1/auth/login",
        data={"username": "admin@test.local", "password": "wrong"},
    )

    assert db.query(LoginAttempt).filter(LoginAttempt.success == False).count() == 1
    assert db.query(AuditLog).filter(AuditLog.action == "login_failed").count() == 1


def test_register_invalid_role_returns_400_not_500(client, admin_token):
    """
    POST /auth/register with an unknown role string used to raise bare
    ValueError and surface as an opaque 500. Now validated explicitly —
    should be a 400 with a helpful list of allowed values.
    """
    res = client.post(
        "/api/v1/auth/register",
        headers=auth_header(admin_token),
        json={
            "username": "newbie",
            "email": "newbie@test.local",
            "password": "secret-password-1",
            "role": "superadmin",  # not a valid UserRole
        },
    )
    assert res.status_code == 400
    detail = res.json()["detail"]
    assert "superadmin" in detail
    assert "admin" in detail and "maintainer" in detail and "viewer" in detail
