"""
Tests for the incident approval flow — mandatory reviewer note and
idempotency guard against double approval. Closes the hostile-QA
findings where:
  - An admin could rubber-stamp an LLM summary with no note (the
    prompt-injection-via-symptoms attack then becomes official record).
  - Two admins racing on approve both succeeded and the second
    silently overwrote approved_by, losing attribution.
"""

from tests.conftest import auth_header
from app.models import (
    AIService, Environment, SensitivityLabel,
    Incident, Severity, IncidentStatus,
)


def _seed_incident_with_draft(db):
    svc = AIService(
        name="S", owner="T", environment=Environment.prod,
        model_name="m", sensitivity_label=SensitivityLabel.internal,
    )
    db.add(svc)
    db.commit()
    db.refresh(svc)

    inc = Incident(
        service_id=svc.id,
        severity=Severity.medium,
        symptoms="latency spike",
        status=IncidentStatus.open,
        summary_draft="Platform experienced elevated latency for 4 minutes.",
    )
    db.add(inc)
    db.commit()
    db.refresh(inc)
    return inc


def test_approve_requires_reviewer_note(client, db, admin_token):
    inc = _seed_incident_with_draft(db)
    res = client.post(
        f"/api/v1/incidents/{inc.id}/approve-summary",
        json={},  # missing reviewer_note
        headers=auth_header(admin_token),
    )
    # FastAPI returns 422 on pydantic validation failure
    assert res.status_code == 422


def test_approve_rejects_short_reviewer_note(client, db, admin_token):
    inc = _seed_incident_with_draft(db)
    res = client.post(
        f"/api/v1/incidents/{inc.id}/approve-summary",
        json={"reviewer_note": "lgtm"},
        headers=auth_header(admin_token),
    )
    assert res.status_code == 422


def test_approve_rejects_whitespace_only_note(client, db, admin_token):
    """Note must have 20 NON-WHITESPACE chars. 20 spaces is insufficient."""
    inc = _seed_incident_with_draft(db)
    res = client.post(
        f"/api/v1/incidents/{inc.id}/approve-summary",
        json={"reviewer_note": " " * 25},
        headers=auth_header(admin_token),
    )
    assert res.status_code == 400


def test_approve_succeeds_with_valid_note(client, db, admin_token, admin_user):
    inc = _seed_incident_with_draft(db)
    res = client.post(
        f"/api/v1/incidents/{inc.id}/approve-summary",
        json={"reviewer_note": "Read full draft — root causes match symptoms, no fabricated claims."},
        headers=auth_header(admin_token),
    )
    assert res.status_code == 200

    db.refresh(inc)
    assert inc.summary == "Platform experienced elevated latency for 4 minutes."
    assert inc.summary_draft == ""
    assert inc.approved_by == admin_user.id
    assert inc.approved_at is not None
    assert "root causes match" in inc.reviewer_note


def test_approve_is_idempotent_409_on_second_call(client, db, admin_token):
    """Second approval returns 409 so attribution isn't overwritten."""
    inc = _seed_incident_with_draft(db)
    note = "Read full draft; root causes tracked; no action needed now."
    first = client.post(
        f"/api/v1/incidents/{inc.id}/approve-summary",
        json={"reviewer_note": note},
        headers=auth_header(admin_token),
    )
    assert first.status_code == 200

    second = client.post(
        f"/api/v1/incidents/{inc.id}/approve-summary",
        json={"reviewer_note": note},
        headers=auth_header(admin_token),
    )
    assert second.status_code == 409
    assert "already approved" in second.json()["detail"].lower()


def test_approve_requires_existing_draft(client, db, admin_token):
    """No draft → nothing to approve. 400, not a silent no-op."""
    svc = AIService(
        name="S", owner="T", environment=Environment.prod,
        model_name="m", sensitivity_label=SensitivityLabel.internal,
    )
    db.add(svc)
    db.commit()
    db.refresh(svc)
    inc = Incident(
        service_id=svc.id, severity=Severity.low,
        symptoms="x", status=IncidentStatus.open,
    )
    db.add(inc)
    db.commit()
    db.refresh(inc)

    res = client.post(
        f"/api/v1/incidents/{inc.id}/approve-summary",
        json={"reviewer_note": "Read incident; nothing to approve yet."},
        headers=auth_header(admin_token),
    )
    assert res.status_code == 400
