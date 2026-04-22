"""
Test configuration — shared fixtures for all backend tests.
Uses an in-memory SQLite database so tests don't touch the real DB.
"""

# Pin a strong SECRET_KEY BEFORE any app import so the startup
# assertion in main.py accepts the test run regardless of what the
# developer's local .env holds. setdefault so CI-provided SECRET_KEY
# still wins. Must live above the `from app.main import app` line —
# Pydantic BaseSettings reads env vars at Settings() construction,
# which is triggered by that import.
import os
os.environ.setdefault(
    "SECRET_KEY",
    "test-suite-secret-key-at-least-thirty-two-characters-long",
)

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.database import Base, get_db
from app.main import app
from app.models import User, UserRole
from app.middleware.auth import hash_password, create_access_token


@pytest.fixture(autouse=True)
def _stub_dns_resolution(monkeypatch):
    """
    Default DNS stub for tests: resolve everything to a public IP (1.1.1.1).
    Keeps the SSRF validator happy for generic fixtures that use test
    URLs like 'staging.example.com' which don't publicly resolve.

    Individual tests that need to exercise SSRF behaviour override this
    with their own patch/context manager.
    """
    import socket

    def fake_getaddrinfo(host, port, *args, **kwargs):
        # Literal IPs must resolve to themselves so SSRF tests using
        # http://169.254.169.254 still detect the blocked range.
        import ipaddress
        try:
            ipaddress.ip_address(host)
            return [(socket.AF_INET, socket.SOCK_STREAM, 6, "", (host, port or 0))]
        except ValueError:
            pass
        # For test hostnames, fake-resolve to a public IP so the validator
        # allows them. Individual tests that need a private-IP resolution
        # patch this directly.
        return [(socket.AF_INET, socket.SOCK_STREAM, 6, "", ("1.1.1.1", port or 0))]

    monkeypatch.setattr(socket, "getaddrinfo", fake_getaddrinfo)

# In-memory SQLite for tests
TEST_DATABASE_URL = "sqlite:///./test.db"
engine = create_engine(TEST_DATABASE_URL, connect_args={"check_same_thread": False})
TestSession = sessionmaker(autocommit=False, autoflush=False, bind=engine)


@pytest.fixture(autouse=True)
def setup_db():
    """Create all tables before each test, drop after."""
    Base.metadata.create_all(bind=engine)
    # Install the append-only triggers on the test engine too.
    from app.main import _install_audit_log_triggers
    from app.database import engine as app_engine
    # Temporarily swap the engine used by the installer so triggers land
    # on the test DB, then restore.
    import app.main as main_module
    orig_engine = main_module.engine
    main_module.engine = engine
    try:
        _install_audit_log_triggers()
    finally:
        main_module.engine = orig_engine
    yield
    # Drop triggers so next test's create_all doesn't conflict
    from sqlalchemy import text
    with engine.begin() as conn:
        conn.execute(text("DROP TRIGGER IF EXISTS audit_log_no_update"))
        conn.execute(text("DROP TRIGGER IF EXISTS audit_log_no_delete"))
    Base.metadata.drop_all(bind=engine)


@pytest.fixture
def db():
    """Yield a test database session."""
    session = TestSession()
    try:
        yield session
    finally:
        session.close()


@pytest.fixture
def client(db):
    """FastAPI test client with overridden DB dependency."""
    def override_get_db():
        try:
            yield db
        finally:
            pass

    app.dependency_overrides[get_db] = override_get_db
    with TestClient(app) as c:
        yield c
    app.dependency_overrides.clear()


@pytest.fixture
def admin_user(db) -> User:
    """Create and return an admin user."""
    user = User(
        username="testadmin",
        email="admin@test.local",
        password_hash=hash_password("admin123"),
        role=UserRole.admin,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


@pytest.fixture
def viewer_user(db) -> User:
    """Create and return a viewer user."""
    user = User(
        username="testviewer",
        email="viewer@test.local",
        password_hash=hash_password("viewer123"),
        role=UserRole.viewer,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


@pytest.fixture
def maintainer_user(db) -> User:
    """Create and return a maintainer user."""
    user = User(
        username="testmaintainer",
        email="maintainer@test.local",
        password_hash=hash_password("maintain123"),
        role=UserRole.maintainer,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


@pytest.fixture
def admin_token(admin_user) -> str:
    """JWT token for admin user."""
    return create_access_token(data={"sub": admin_user.id, "role": "admin"})


@pytest.fixture
def viewer_token(viewer_user) -> str:
    """JWT token for viewer user."""
    return create_access_token(data={"sub": viewer_user.id, "role": "viewer"})


@pytest.fixture
def maintainer_token(maintainer_user) -> str:
    """JWT token for maintainer user."""
    return create_access_token(data={"sub": maintainer_user.id, "role": "maintainer"})


def auth_header(token: str) -> dict:
    """Helper to build Authorization header."""
    return {"Authorization": f"Bearer {token}"}
