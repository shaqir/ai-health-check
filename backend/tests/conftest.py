"""
Test configuration — shared fixtures for all backend tests.
Uses an in-memory SQLite database so tests don't touch the real DB.
"""

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.database import Base, get_db
from app.main import app
from app.models import User, UserRole
from app.middleware.auth import hash_password, create_access_token

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
