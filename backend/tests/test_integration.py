"""
Integration Tests — end-to-end workflows across multiple modules.
Minimum required: 2 integration tests.
"""

from tests.conftest import auth_header
from app.models import AuditLog


# ── Integration Test 1: Full Service Lifecycle ──

def test_full_service_lifecycle(client, admin_token, db):
    """
    End-to-end: Register service → Read → Update → Verify audit log → Delete.
    Tests that CRUD + audit logging work together across the stack.
    """
    # 1. Create a service
    create_res = client.post(
        "/api/v1/services/",
        json={
            "name": "Integration Test Bot",
            "owner": "QA Team",
            "environment": "dev",
            "model_name": "claude-sonnet-4-6-20250415",
            "sensitivity_label": "confidential",
        },
        headers=auth_header(admin_token),
    )
    assert create_res.status_code == 200
    service_id = create_res.json()["id"]
    assert create_res.json()["sensitivity_label"] == "confidential"

    # 2. Read it back
    get_res = client.get(
        f"/api/v1/services/{service_id}",
        headers=auth_header(admin_token),
    )
    assert get_res.status_code == 200
    assert get_res.json()["name"] == "Integration Test Bot"

    # 3. Update it
    update_res = client.put(
        f"/api/v1/services/{service_id}",
        json={"name": "Updated Bot", "sensitivity_label": "internal"},
        headers=auth_header(admin_token),
    )
    assert update_res.status_code == 200
    assert update_res.json()["name"] == "Updated Bot"
    assert update_res.json()["sensitivity_label"] == "internal"

    # 4. Verify audit log has entries
    audit_entries = db.query(AuditLog).filter(
        AuditLog.target_table == "ai_services",
        AuditLog.target_id == service_id,
    ).all()
    actions = [e.action for e in audit_entries]
    assert "create_service" in actions
    assert "update_service" in actions

    # 5. Delete it
    delete_res = client.delete(
        f"/api/v1/services/{service_id}",
        headers=auth_header(admin_token),
    )
    assert delete_res.status_code == 200

    # 6. Verify audit log has the delete entry
    all_entries = db.query(AuditLog).filter(
        AuditLog.target_table == "ai_services",
        AuditLog.target_id == service_id,
    ).all()
    all_actions = [e.action for e in all_entries]
    assert "delete_service" in all_actions


# ── Integration Test 2: RBAC Across Multiple Operations ──

def test_rbac_full_enforcement(client, admin_token, viewer_token, db):
    """
    End-to-end: Admin creates service → Viewer can read but not modify.
    Tests that RBAC is consistently enforced across all CRUD operations.
    """
    # Admin creates a service
    create_res = client.post(
        "/api/v1/services/",
        json={
            "name": "RBAC Test Service",
            "owner": "Security Team",
            "environment": "prod",
            "model_name": "claude-sonnet-4-6-20250415",
            "sensitivity_label": "public",
        },
        headers=auth_header(admin_token),
    )
    assert create_res.status_code == 200
    service_id = create_res.json()["id"]

    # Viewer CAN read the service list
    list_res = client.get("/api/v1/services/", headers=auth_header(viewer_token))
    assert list_res.status_code == 200
    assert len(list_res.json()) >= 1

    # Viewer CAN read a single service
    get_res = client.get(
        f"/api/v1/services/{service_id}",
        headers=auth_header(viewer_token),
    )
    assert get_res.status_code == 200

    # Viewer CANNOT update
    update_res = client.put(
        f"/api/v1/services/{service_id}",
        json={"name": "Hacked"},
        headers=auth_header(viewer_token),
    )
    assert update_res.status_code == 403

    # Viewer CANNOT delete
    delete_res = client.delete(
        f"/api/v1/services/{service_id}",
        headers=auth_header(viewer_token),
    )
    assert delete_res.status_code == 403

    # Viewer CANNOT test connection
    test_res = client.post(
        f"/api/v1/services/{service_id}/test-connection",
        headers=auth_header(viewer_token),
    )
    assert test_res.status_code == 403

    # Verify the service was NOT modified
    verify_res = client.get(
        f"/api/v1/services/{service_id}",
        headers=auth_header(admin_token),
    )
    assert verify_res.json()["name"] == "RBAC Test Service"  # Still original name
