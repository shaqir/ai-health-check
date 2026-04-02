"""
Unit tests for auth, services CRUD, RBAC, and connection checks.
"""

from app.routers import services as services_router
from tests.conftest import auth_header


def test_login_success(client, admin_user):
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
    response = client.post(
        "/api/v1/auth/login",
        data={"username": "admin@test.local", "password": "wrongpass"},
    )
    assert response.status_code == 401


def test_create_service(client, admin_token):
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


def test_create_service_supports_staging(client, admin_token):
    response = client.post(
        "/api/v1/services/",
        json={
            "name": "Staging Bot",
            "owner": "Platform",
            "environment": "staging",
            "model_name": "claude-sonnet-4-20250514",
            "sensitivity_label": "internal",
            "endpoint_url": "https://staging.example.com/health",
        },
        headers=auth_header(admin_token),
    )
    assert response.status_code == 200
    assert response.json()["environment"] == "staging"


def test_create_service_invalid_sensitivity(client, admin_token):
    response = client.post(
        "/api/v1/services/",
        json={
            "name": "Bad Service",
            "owner": "Test",
            "environment": "dev",
            "model_name": "test",
            "sensitivity_label": "top_secret",
        },
        headers=auth_header(admin_token),
    )
    assert response.status_code == 400


def test_list_services(client, admin_token):
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


def test_update_service(client, admin_token):
    create_res = client.post(
        "/api/v1/services/",
        json={
            "name": "Original",
            "owner": "Platform",
            "environment": "dev",
            "model_name": "claude-sonnet-4-20250514",
            "sensitivity_label": "public",
            "endpoint_url": "https://old.example.com/health",
        },
        headers=auth_header(admin_token),
    )
    service_id = create_res.json()["id"]

    response = client.put(
        f"/api/v1/services/{service_id}",
        json={
            "environment": "staging",
            "endpoint_url": "https://new.example.com/health",
            "is_active": False,
        },
        headers=auth_header(admin_token),
    )
    assert response.status_code == 200
    data = response.json()
    assert data["environment"] == "staging"
    assert data["endpoint_url"] == "https://new.example.com/health"
    assert data["is_active"] is False


def test_test_connection_success(client, admin_token, monkeypatch):
    async def fake_probe(endpoint_url: str):
        assert endpoint_url == "https://service.example.com/health"
        return {
            "status": "success",
            "latency_ms": 12.3,
            "response_snippet": "ok",
        }

    monkeypatch.setattr(services_router, "_probe_service_endpoint", fake_probe)

    create_res = client.post(
        "/api/v1/services/",
        json={
            "name": "Health Bot",
            "owner": "Ops",
            "environment": "prod",
            "model_name": "claude-sonnet-4-20250514",
            "sensitivity_label": "internal",
            "endpoint_url": "https://service.example.com/health",
        },
        headers=auth_header(admin_token),
    )
    service_id = create_res.json()["id"]

    response = client.post(
        f"/api/v1/services/{service_id}/test-connection",
        headers=auth_header(admin_token),
    )
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "success"
    assert data["endpoint_url"] == "https://service.example.com/health"
    assert data["latency_ms"] == 12.3


def test_test_connection_requires_endpoint_url(client, admin_token):
    create_res = client.post(
        "/api/v1/services/",
        json={
            "name": "No URL Bot",
            "owner": "Ops",
            "environment": "dev",
            "model_name": "claude-sonnet-4-20250514",
            "sensitivity_label": "internal",
        },
        headers=auth_header(admin_token),
    )
    service_id = create_res.json()["id"]

    response = client.post(
        f"/api/v1/services/{service_id}/test-connection",
        headers=auth_header(admin_token),
    )
    assert response.status_code == 400
    assert "endpoint_url" in response.json()["detail"]


def test_viewer_cannot_create_service(client, viewer_token):
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


def test_viewer_cannot_delete_service(client, admin_token, viewer_token):
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

    response = client.delete(
        f"/api/v1/services/{service_id}",
        headers=auth_header(viewer_token),
    )
    assert response.status_code == 403


def test_delete_service(client, admin_token):
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

    get_res = client.get(
        f"/api/v1/services/{service_id}",
        headers=auth_header(admin_token),
    )
    assert get_res.status_code == 404


def test_unauthenticated_access_blocked(client):
    response = client.get("/api/v1/services/")
    assert response.status_code == 401
