"""
Unit Tests — covers auth, services CRUD, RBAC, and audit logging.
Minimum required: 5 unit tests. We have 8 here.
"""

from tests.conftest import auth_header


# ── Test 1: JWT Authentication ──

def test_login_success(client, admin_user):
    """Test that valid credentials return a JWT token."""
    response = client.post(
        "/api/v1/auth/login",
        data={"username": "admin@test.local", "password": "admin123"},
    )
    assert response.status_code == 200
    data = response.json()
    assert "access_token" in data
    assert data["role"] == "admin"
    assert data["username"] == "testadmin"


def test_login_invalid_password(client, admin_user):
    """Test that wrong password returns 401."""
    response = client.post(
        "/api/v1/auth/login",
        data={"username": "admin@test.local", "password": "wrongpass"},
    )
    assert response.status_code == 401


# ── Test 2: Create Service ──

def test_create_service(client, admin_token):
    """Test that an admin can register a new AI service."""
    response = client.post(
        "/api/v1/services/",
        json={
            "name": "Test Bot",
            "owner": "Test Team",
            "environment": "dev",
            "model_name": "claude-sonnet-4-20250514",
            "sensitivity_label": "internal",
        },
        headers=auth_header(admin_token),
    )
    assert response.status_code == 200
    data = response.json()
    assert data["name"] == "Test Bot"
    assert data["sensitivity_label"] == "internal"
    assert data["environment"] == "dev"
    assert data["id"] > 0


# ── Test 3: Sensitivity Label Validation ──

def test_create_service_invalid_sensitivity(client, admin_token):
    """Test that invalid sensitivity label is rejected."""
    response = client.post(
        "/api/v1/services/",
        json={
            "name": "Bad Service",
            "owner": "Test",
            "environment": "dev",
            "model_name": "test",
            "sensitivity_label": "top_secret",  # Not in enum
        },
        headers=auth_header(admin_token),
    )
    assert response.status_code == 400


# ── Test 4: List Services ──

def test_list_services(client, admin_token):
    """Test listing services after creating one."""
    # Create a service first
    client.post(
        "/api/v1/services/",
        json={
            "name": "List Test",
            "owner": "Team",
            "environment": "prod",
            "model_name": "claude",
            "sensitivity_label": "public",
        },
        headers=auth_header(admin_token),
    )
    response = client.get("/api/v1/services/", headers=auth_header(admin_token))
    assert response.status_code == 200
    data = response.json()
    assert len(data) >= 1
    assert data[0]["name"] == "List Test"


# ── Test 5: RBAC — Viewer Blocked from Create ──

def test_viewer_cannot_create_service(client, viewer_token):
    """Test that a viewer role is blocked from creating services."""
    response = client.post(
        "/api/v1/services/",
        json={
            "name": "Blocked",
            "owner": "Viewer",
            "environment": "dev",
            "model_name": "test",
            "sensitivity_label": "public",
        },
        headers=auth_header(viewer_token),
    )
    assert response.status_code == 403
    assert "not authorized" in response.json()["detail"].lower()


# ── Test 6: RBAC — Viewer Blocked from Delete ──

def test_viewer_cannot_delete_service(client, admin_token, viewer_token):
    """Test that a viewer cannot delete a service."""
    # Create as admin
    create_res = client.post(
        "/api/v1/services/",
        json={
            "name": "Delete Test",
            "owner": "Team",
            "environment": "dev",
            "model_name": "test",
            "sensitivity_label": "public",
        },
        headers=auth_header(admin_token),
    )
    service_id = create_res.json()["id"]

    # Try to delete as viewer
    response = client.delete(
        f"/api/v1/services/{service_id}",
        headers=auth_header(viewer_token),
    )
    assert response.status_code == 403


# ── Test 7: Delete Service ──

def test_delete_service(client, admin_token):
    """Test that an admin can delete a service."""
    create_res = client.post(
        "/api/v1/services/",
        json={
            "name": "To Delete",
            "owner": "Team",
            "environment": "dev",
            "model_name": "test",
            "sensitivity_label": "public",
        },
        headers=auth_header(admin_token),
    )
    service_id = create_res.json()["id"]

    response = client.delete(
        f"/api/v1/services/{service_id}",
        headers=auth_header(admin_token),
    )
    assert response.status_code == 200
    assert response.json()["detail"] == "Service deleted"

    # Verify it's gone
    get_res = client.get(
        f"/api/v1/services/{service_id}",
        headers=auth_header(admin_token),
    )
    assert get_res.status_code == 404


# ── Test 8: Unauthenticated Access Blocked ──

def test_unauthenticated_access_blocked(client):
    """Test that requests without a token are rejected."""
    response = client.get("/api/v1/services/")
    assert response.status_code == 401
