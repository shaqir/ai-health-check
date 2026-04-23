"""
Unit tests for auth, services CRUD, RBAC, and connection checks.
"""

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
            "model_name": "claude-sonnet-4-6-20250415",
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
            "model_name": "claude-sonnet-4-6-20250415",
            "sensitivity_label": "internal",
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
            "model_name": "claude-sonnet-4-6-20250415",
            "sensitivity_label": "public",
        },
        headers=auth_header(admin_token),
    )
    service_id = create_res.json()["id"]

    response = client.put(
        f"/api/v1/services/{service_id}",
        json={
            "environment": "staging",
            "is_active": False,
        },
        headers=auth_header(admin_token),
    )
    assert response.status_code == 200
    data = response.json()
    assert data["environment"] == "staging"
    assert data["is_active"] is False


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


# ── Confidential sensitivity label enforcement ──

def _create_confidential_service(client, admin_token, db):
    """Helper: register a confidential-labelled service and return its id."""
    res = client.post(
        "/api/v1/services/",
        json={
            "name": "Secret Bot",
            "owner": "Legal",
            "environment": "prod",
            "model_name": "claude-sonnet-4-6-20250415",
            "sensitivity_label": "confidential",
        },
        headers=auth_header(admin_token),
    )
    assert res.status_code in (200, 201)
    return res.json()["id"]


def test_confidential_service_allows_llm_without_override(client, db, admin_token, monkeypatch):
    """The sensitivity gate is disabled — confidential services let the LLM
    call through for any user with the right role, with no override flag."""
    async def _fake_test_connection(model=None, **kwargs):
        return {"status": "success", "latency_ms": 1, "response_snippet": "ok"}

    monkeypatch.setattr(
        "app.routers.services.llm_test_connection", _fake_test_connection
    )

    service_id = _create_confidential_service(client, admin_token, db)

    res = client.post(
        f"/api/v1/services/{service_id}/test-connection?mode=llm",
        headers=auth_header(admin_token),
    )
    assert res.status_code == 200


def test_maintainer_can_llm_test_confidential(client, db, admin_token, maintainer_token, monkeypatch):
    """With the gate removed, maintainers can also run a live LLM test
    against confidential services."""
    async def _fake_test_connection(model=None, **kwargs):
        return {"status": "success", "latency_ms": 1, "response_snippet": "ok"}

    monkeypatch.setattr(
        "app.routers.services.llm_test_connection", _fake_test_connection
    )

    service_id = _create_confidential_service(client, admin_token, db)

    res = client.post(
        f"/api/v1/services/{service_id}/test-connection?mode=llm",
        headers=auth_header(maintainer_token),
    )
    assert res.status_code == 200


def test_public_service_not_gated(client, db, admin_token, monkeypatch):
    """Public services bypass the sensitivity gate entirely."""
    async def _fake_test_connection(model=None, **kwargs):
        # **kwargs absorbs user_id + service_id, added when observability
        # threading landed in commit e0940c5. Accepting them keeps the
        # stub compatible with both old and new call-sites.
        return {"status": "success", "latency_ms": 1, "response_snippet": "ok"}

    monkeypatch.setattr(
        "app.routers.services.llm_test_connection", _fake_test_connection
    )

    res = client.post(
        "/api/v1/services/",
        json={
            "name": "Public Bot",
            "owner": "Marketing",
            "environment": "prod",
            "model_name": "claude-sonnet-4-6-20250415",
            "sensitivity_label": "public",
        },
        headers=auth_header(admin_token),
    )
    service_id = res.json()["id"]

    res = client.post(
        f"/api/v1/services/{service_id}/test-connection?mode=llm",
        headers=auth_header(admin_token),
    )
    assert res.status_code == 200
