"""
Compliance trail — cascade deletes must leave an audit trail.

`AIService` has `cascade="all, delete-orphan"` on `incidents`, and
`Incident` has the same on `maintenance_plans`. Before this fix a
compliance reviewer asking "who deleted this incident?" got nothing:
the ORM quietly swept the children and only the parent delete wrote
an audit row.

These tests guard the contract that `DELETE /services/{id}` writes
one audit row per cascaded child (incident + maintenance plan) with
the original target id and attribution, BEFORE the final
`delete_service` row.
"""

from sqlalchemy import select

from app.models import (
    AIService,
    AuditLog,
    Environment,
    Incident,
    IncidentStatus,
    MaintenancePlan,
    SensitivityLabel,
    Severity,
)
from tests.conftest import auth_header


def _seed_service(db, name: str = "AuditMe") -> AIService:
    svc = AIService(
        name=name,
        owner="QA",
        environment=Environment.dev,
        model_name="test-model",
        sensitivity_label=SensitivityLabel.public,
    )
    db.add(svc)
    db.commit()
    db.refresh(svc)
    return svc


def _seed_incident(db, service_id: int, symptoms: str = "sym") -> Incident:
    inc = Incident(
        service_id=service_id,
        severity=Severity.medium,
        symptoms=symptoms,
        status=IncidentStatus.open,
    )
    db.add(inc)
    db.commit()
    db.refresh(inc)
    return inc


def _seed_plan(db, incident_id: int, risk: Severity = Severity.low) -> MaintenancePlan:
    plan = MaintenancePlan(
        incident_id=incident_id,
        risk_level=risk,
        rollback_plan="revert",
        validation_steps="smoke",
    )
    db.add(plan)
    db.commit()
    db.refresh(plan)
    return plan


def _audit_rows_for(db, action: str) -> list[AuditLog]:
    return db.execute(
        select(AuditLog).where(AuditLog.action == action)
    ).scalars().all()


# ── Regression baseline ─────────────────────────────────────────────

def test_delete_service_without_children_audits_only_itself(client, db, admin_token):
    """Service with no incidents: exactly one `delete_service` audit row,
    zero cascade rows. Regression guard for the no-children path."""
    svc = _seed_service(db, name="LoneService")
    res = client.delete(
        f"/api/v1/services/{svc.id}",
        headers=auth_header(admin_token),
    )
    assert res.status_code == 200

    delete_rows = _audit_rows_for(db, "delete_service")
    assert len(delete_rows) == 1, "exactly one delete_service audit row expected"
    assert delete_rows[0].target_id == svc.id

    # No cascade rows when there's nothing to cascade.
    assert _audit_rows_for(db, "cascade_delete_incident") == []
    assert _audit_rows_for(db, "cascade_delete_maintenance_plan") == []


# ── Cascade coverage ────────────────────────────────────────────────

def test_delete_service_audits_cascaded_incidents(client, db, admin_token):
    """Service with 2 incidents, 0 plans: expect 2 cascade_delete_incident
    rows plus the service's delete_service row. Each cascade row carries
    the original incident.id as target_id so the trail is queryable."""
    svc = _seed_service(db, name="WithIncidents")
    inc_a = _seed_incident(db, svc.id, symptoms="A")
    inc_b = _seed_incident(db, svc.id, symptoms="B")
    inc_ids = {inc_a.id, inc_b.id}

    res = client.delete(
        f"/api/v1/services/{svc.id}",
        headers=auth_header(admin_token),
    )
    assert res.status_code == 200

    cascade_rows = _audit_rows_for(db, "cascade_delete_incident")
    assert len(cascade_rows) == 2
    assert {row.target_id for row in cascade_rows} == inc_ids

    # Parent delete still audited.
    delete_rows = _audit_rows_for(db, "delete_service")
    assert len(delete_rows) == 1 and delete_rows[0].target_id == svc.id


def test_delete_service_audits_cascaded_incidents_and_maintenance_plans(
    client, db, admin_token,
):
    """Full cascade: 1 incident with 2 maintenance plans. Expect:
      2 × cascade_delete_maintenance_plan
      1 × cascade_delete_incident
      1 × delete_service
    All with correct target_ids so a reviewer can reconstruct the tree
    after the fact."""
    svc = _seed_service(db, name="DeepCascade")
    inc = _seed_incident(db, svc.id)
    plan_a = _seed_plan(db, inc.id, risk=Severity.low)
    plan_b = _seed_plan(db, inc.id, risk=Severity.high)
    plan_ids = {plan_a.id, plan_b.id}

    res = client.delete(
        f"/api/v1/services/{svc.id}",
        headers=auth_header(admin_token),
    )
    assert res.status_code == 200

    plan_rows = _audit_rows_for(db, "cascade_delete_maintenance_plan")
    assert len(plan_rows) == 2
    assert {row.target_id for row in plan_rows} == plan_ids

    incident_rows = _audit_rows_for(db, "cascade_delete_incident")
    assert len(incident_rows) == 1
    assert incident_rows[0].target_id == inc.id

    delete_rows = _audit_rows_for(db, "delete_service")
    assert len(delete_rows) == 1 and delete_rows[0].target_id == svc.id
