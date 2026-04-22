"""
Tests for `backend/scripts/rotate_seed_passwords.py` — the one-shot
that rotates seed users' password hashes from SEED_*_PASSWORD env
vars WITHOUT dropping the rest of the database.

The script is standalone (not part of app/) so tests import it
directly via `scripts.rotate_seed_passwords`. The `SessionLocal` name
inside the script is monkey-patched to the test engine, same pattern
as test_scheduled_health_check.py.
"""

import pytest

from scripts.rotate_seed_passwords import rotate_seed_passwords
from app.models import AuditLog, User, UserRole
from app.middleware.auth import hash_password, verify_password
from tests.conftest import TestSession


@pytest.fixture(autouse=True)
def _point_script_at_test_db(monkeypatch):
    """The script uses `app.database.SessionLocal` which, unpatched,
    points at the real aiops.db. Repoint each test at the test
    engine's session factory."""
    monkeypatch.setattr(
        "scripts.rotate_seed_passwords.SessionLocal", TestSession,
    )


def _seed_user(db, email: str, role: UserRole, pwd: str) -> User:
    user = User(
        username=email.split("@")[0],
        email=email,
        password_hash=hash_password(pwd),
        role=role,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


# ── Happy path ──────────────────────────────────────────────────────

def test_rotates_admin_when_env_var_set(client, db, monkeypatch):
    admin = _seed_user(db, "admin@aiops.local", UserRole.admin, "old_pw")
    monkeypatch.setenv("SEED_ADMIN_PASSWORD", "new_pw_for_admin_2026")
    # Other env vars intentionally unset so only admin should rotate.
    monkeypatch.delenv("SEED_MAINTAINER_PASSWORD", raising=False)
    monkeypatch.delenv("SEED_VIEWER_PASSWORD", raising=False)

    result = rotate_seed_passwords()

    assert "admin@aiops.local" in result["rotated"]

    # Re-query through the test session so we see the committed value.
    db.expire_all()
    refreshed = db.query(User).filter(User.email == "admin@aiops.local").first()
    assert verify_password("new_pw_for_admin_2026", refreshed.password_hash)
    assert not verify_password("old_pw", refreshed.password_hash)


# ── Skip: env var unset ────────────────────────────────────────────

def test_skips_when_env_var_unset(client, db, monkeypatch):
    admin = _seed_user(db, "admin@aiops.local", UserRole.admin, "old_pw")
    monkeypatch.delenv("SEED_ADMIN_PASSWORD", raising=False)
    monkeypatch.delenv("SEED_MAINTAINER_PASSWORD", raising=False)
    monkeypatch.delenv("SEED_VIEWER_PASSWORD", raising=False)
    original_hash = admin.password_hash

    result = rotate_seed_passwords()

    assert "admin@aiops.local" in result["skipped"]

    db.expire_all()
    refreshed = db.query(User).filter(User.email == "admin@aiops.local").first()
    assert refreshed.password_hash == original_hash


# ── Skip: whitespace-only env value counts as unset ────────────────

def test_skips_when_env_var_is_whitespace(client, db, monkeypatch):
    admin = _seed_user(db, "admin@aiops.local", UserRole.admin, "old_pw")
    monkeypatch.setenv("SEED_ADMIN_PASSWORD", "   ")  # whitespace only
    monkeypatch.delenv("SEED_MAINTAINER_PASSWORD", raising=False)
    monkeypatch.delenv("SEED_VIEWER_PASSWORD", raising=False)
    original_hash = admin.password_hash

    result = rotate_seed_passwords()

    assert "admin@aiops.local" in result["skipped"]
    db.expire_all()
    refreshed = db.query(User).filter(User.email == "admin@aiops.local").first()
    assert refreshed.password_hash == original_hash


# ── Missing: user not in DB ────────────────────────────────────────

def test_reports_missing_when_user_not_in_db(client, db, monkeypatch):
    # Intentionally seed nobody.
    monkeypatch.setenv("SEED_ADMIN_PASSWORD", "new_pw")
    monkeypatch.delenv("SEED_MAINTAINER_PASSWORD", raising=False)
    monkeypatch.delenv("SEED_VIEWER_PASSWORD", raising=False)

    result = rotate_seed_passwords()

    assert "admin@aiops.local" in result["missing"]
    assert "admin@aiops.local" not in result["rotated"]


# ── Audit trail ────────────────────────────────────────────────────

def test_writes_audit_row_per_rotation(client, db, monkeypatch):
    admin = _seed_user(db, "admin@aiops.local", UserRole.admin, "old_pw")
    monkeypatch.setenv("SEED_ADMIN_PASSWORD", "rotated_value_2026_q2")
    monkeypatch.delenv("SEED_MAINTAINER_PASSWORD", raising=False)
    monkeypatch.delenv("SEED_VIEWER_PASSWORD", raising=False)

    before = db.query(AuditLog).filter(
        AuditLog.action == "rotate_password",
    ).count()
    rotate_seed_passwords()
    after = db.query(AuditLog).filter(
        AuditLog.action == "rotate_password",
    ).count()

    assert after == before + 1, (
        "expected exactly one rotate_password row for one rotated user"
    )

    row = db.query(AuditLog).filter(
        AuditLog.action == "rotate_password",
    ).order_by(AuditLog.id.desc()).first()
    assert row.target_id == admin.id
    assert row.target_table == "users"
    # Audit detail carries the env var name so forensics can trace WHICH
    # rotation event corresponds to WHICH policy change.
    assert "SEED_ADMIN_PASSWORD" in (row.new_value or "")
    # System action — not attributed to an API user.
    assert row.user_id is None


# ── Mixed: all three code paths in a single call ───────────────────

def test_mixed_rotate_skip_missing_all_in_one_run(client, db, monkeypatch):
    """One call exercises all three outcomes: rotate (admin), missing
    (maintainer), skip (viewer). Proves the function doesn't bail on
    the first non-rotate case."""
    admin = _seed_user(db, "admin@aiops.local", UserRole.admin, "a_old")
    # maintainer NOT seeded — should land in `missing`
    viewer = _seed_user(db, "viewer@aiops.local", UserRole.viewer, "v_old")

    monkeypatch.setenv("SEED_ADMIN_PASSWORD", "a_new")
    monkeypatch.setenv("SEED_MAINTAINER_PASSWORD", "m_new")  # user missing
    monkeypatch.delenv("SEED_VIEWER_PASSWORD", raising=False)  # env unset

    result = rotate_seed_passwords()

    assert "admin@aiops.local" in result["rotated"]
    assert "maintainer@aiops.local" in result["missing"]
    assert "viewer@aiops.local" in result["skipped"]

    # Only the one rotation should produce an audit row.
    rotate_rows = db.query(AuditLog).filter(
        AuditLog.action == "rotate_password",
    ).count()
    assert rotate_rows == 1
