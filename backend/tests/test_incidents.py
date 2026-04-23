"""
Tests for the incident approval flow — mandatory reviewer note and
idempotency guard against double approval. Closes the hostile-QA
findings where:
  - An admin could rubber-stamp an LLM summary with no note (the
    prompt-injection-via-symptoms attack then becomes official record).
  - Two admins racing on approve both succeeded and the second
    silently overwrote approved_by, losing attribution.
"""

from unittest.mock import AsyncMock, patch

from tests.conftest import auth_header
from app.models import (
    AIService, Environment, SensitivityLabel,
    Incident, Severity, IncidentStatus, MaintenancePlan,
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


# ── Priority regression guards (parity sweep) ────────────────────────────────

def _seed_service_in(db, env, name="svc"):
    svc = AIService(
        name=name, owner="Team", environment=env,
        model_name="claude-sonnet-4-6",
        sensitivity_label=SensitivityLabel.internal,
    )
    db.add(svc)
    db.commit()
    db.refresh(svc)
    return svc


def test_env_filter_scopes_incidents(client, db, admin_token):
    """
    GET /incidents?environment=<env> must scope results via apply_env_filter,
    matching the Dashboard + Evaluations convention. Was missing before the
    parity sweep.
    """
    dev_svc = _seed_service_in(db, Environment.dev, "dev-svc")
    prod_svc = _seed_service_in(db, Environment.prod, "prod-svc")
    db.add(Incident(service_id=dev_svc.id, severity=Severity.medium, symptoms="dev-s", status=IncidentStatus.open))
    db.add(Incident(service_id=prod_svc.id, severity=Severity.medium, symptoms="prod-s", status=IncidentStatus.open))
    db.commit()

    h = auth_header(admin_token)

    all_incs = client.get("/api/v1/incidents", headers=h).json()
    assert {i["service_name"] for i in all_incs} >= {"dev-svc", "prod-svc"}

    dev_incs = client.get("/api/v1/incidents?environment=dev", headers=h).json()
    assert {i["service_name"] for i in dev_incs} == {"dev-svc"}, (
        f"expected only dev-svc when env=dev, got {[i['service_name'] for i in dev_incs]}"
    )


def test_maintenance_plan_approval_is_idempotent_409(client, db, admin_token):
    """
    PUT /maintenance/{id}/approve must return 409 on second call so
    duplicate audit rows can't be created by a double-click. Parity with
    the incident summary approval guard above.
    """
    svc = _seed_service_in(db, Environment.prod, "svc")
    inc = Incident(service_id=svc.id, severity=Severity.medium, symptoms="x", status=IncidentStatus.open)
    db.add(inc)
    db.commit()
    db.refresh(inc)

    create_res = client.post(
        "/api/v1/maintenance",
        json={
            "incident_id": inc.id,
            "risk_level": "medium",
            "rollback_plan": "Revert the deployment and restore the previous image.",
            "validation_steps": "Ping health endpoint; run smoke eval suite.",
        },
        headers=auth_header(admin_token),
    )
    assert create_res.status_code == 200
    plan_id = create_res.json()["id"]
    # Plans must start unapproved — no way to set approved=true at creation.
    assert create_res.json()["approved"] is False

    first = client.put(f"/api/v1/maintenance/{plan_id}/approve", headers=auth_header(admin_token))
    assert first.status_code == 200
    assert first.json()["approved"] is True
    assert first.json()["approved_by_email"] is not None
    assert first.json()["approved_at"] is not None

    second = client.put(f"/api/v1/maintenance/{plan_id}/approve", headers=auth_header(admin_token))
    assert second.status_code == 409
    assert "already approved" in second.json()["detail"].lower()


def test_incident_deletion_cascades_to_maintenance_plans(db):
    """
    Deleting an Incident must cascade to its MaintenancePlan children — the
    relationship is set cascade="all, delete-orphan". Guards against silent
    orphan regression, same class of bug as EvalTestCase → EvalResult.
    """
    svc = _seed_service_in(db, Environment.prod, "svc-cascade")
    inc = Incident(service_id=svc.id, severity=Severity.high, symptoms="symptoms", status=IncidentStatus.open)
    db.add(inc)
    db.commit()
    db.refresh(inc)

    plan = MaintenancePlan(
        incident_id=inc.id,
        risk_level=Severity.medium,
        rollback_plan="revert",
        validation_steps="smoke test",
    )
    db.add(plan)
    db.commit()
    plan_id = plan.id

    db.delete(inc)
    db.commit()

    db.expire_all()
    assert db.query(MaintenancePlan).filter(MaintenancePlan.id == plan_id).first() is None, (
        "MaintenancePlan must be cascade-deleted with its parent Incident"
    )


@patch("app.routers.incidents.generate_summary", new_callable=AsyncMock)
def test_generate_summary_passes_checklist_to_llm(mock_gen, client, db, admin_token):
    """
    The generate-summary endpoint must pass the 5 checklist values to the
    LLM prompt-builder. The spec calls this out as the "bridge to the LLM" —
    if the prompt-builder is refactored and the flags are dropped, the LLM
    produces a generic post-mortem instead of reasoning against the
    investigator's specific hypotheses.
    """
    mock_gen.return_value = {
        "summary_draft": "synthetic draft",
        "root_causes_draft": "synthetic root causes",
    }

    svc = _seed_service_in(db, Environment.prod, "svc-llm")
    inc = Incident(
        service_id=svc.id,
        severity=Severity.high,
        symptoms="500ms p99 spike",
        status=IncidentStatus.open,
        checklist_data_issue=True,
        checklist_prompt_change=True,
        checklist_model_update=False,
        checklist_infrastructure=False,
        checklist_safety_policy=False,
    )
    db.add(inc)
    db.commit()
    db.refresh(inc)

    res = client.post(f"/api/v1/incidents/{inc.id}/generate-summary", headers=auth_header(admin_token))
    assert res.status_code == 200

    assert mock_gen.called, "generate_summary should be invoked by the endpoint"
    kwargs = mock_gen.call_args.kwargs
    checklist = kwargs.get("checklist")
    assert checklist is not None, "checklist must be passed into generate_summary"
    # The two True flags must be present as True; the three False must be False.
    assert checklist.get("Data Issue") is True
    assert checklist.get("Prompt Change") is True
    assert checklist.get("Model Update") is False
    assert checklist.get("Infrastructure") is False
    assert checklist.get("Safety Policy") is False
    # Symptoms + severity also flow through so the prompt can reference them.
    assert kwargs.get("symptoms") == "500ms p99 spike"
    assert kwargs.get("severity") == "high"


def test_incident_response_exposes_service_sensitivity(client, db, admin_token):
    """
    The frontend needs to know a service's sensitivity label *before* clicking
    "Generate draft" so it can show the override modal (or hide the button
    for non-admins). Regression guard for the field being silently removed.
    """
    svc = AIService(
        name="Confidential-svc", owner="T", environment=Environment.prod,
        model_name="claude-haiku-4-5-20251001",
        sensitivity_label=SensitivityLabel.confidential,
    )
    db.add(svc)
    db.commit()
    db.refresh(svc)
    inc = Incident(
        service_id=svc.id, severity=Severity.medium,
        symptoms="x", status=IncidentStatus.open,
    )
    db.add(inc)
    db.commit()

    res = client.get("/api/v1/incidents", headers=auth_header(admin_token))
    assert res.status_code == 200
    row = next(r for r in res.json() if r["id"] == inc.id)
    assert row["service_sensitivity"] == "confidential"


@patch("app.routers.incidents.generate_summary", new_callable=AsyncMock)
def test_generate_summary_allowed_on_confidential_without_override(
    mock_gen, client, db, admin_token
):
    """The sensitivity gate is disabled — admins can generate a summary
    on a confidential-labelled service without any override flag."""
    mock_gen.return_value = {"summary_draft": "s", "root_causes_draft": "r"}
    svc = AIService(
        name="Conf", owner="T", environment=Environment.prod,
        model_name="claude-haiku-4-5-20251001",
        sensitivity_label=SensitivityLabel.confidential,
    )
    db.add(svc); db.commit(); db.refresh(svc)
    inc = Incident(
        service_id=svc.id, severity=Severity.medium,
        symptoms="x", status=IncidentStatus.open,
    )
    db.add(inc); db.commit(); db.refresh(inc)

    res = client.post(
        f"/api/v1/incidents/{inc.id}/generate-summary",
        headers=auth_header(admin_token),
    )
    assert res.status_code == 200
    assert mock_gen.called


@patch("app.routers.incidents.generate_summary", new_callable=AsyncMock)
def test_generate_summary_allowed_for_maintainer_on_confidential(
    mock_gen, client, db, maintainer_token
):
    """With the gate removed, maintainers can also generate a draft against
    confidential services — RBAC still applies at the route level."""
    mock_gen.return_value = {"summary_draft": "s", "root_causes_draft": "r"}
    svc = AIService(
        name="Conf", owner="T", environment=Environment.prod,
        model_name="claude-haiku-4-5-20251001",
        sensitivity_label=SensitivityLabel.confidential,
    )
    db.add(svc); db.commit(); db.refresh(svc)
    inc = Incident(
        service_id=svc.id, severity=Severity.medium,
        symptoms="x", status=IncidentStatus.open,
    )
    db.add(inc); db.commit(); db.refresh(inc)

    res = client.post(
        f"/api/v1/incidents/{inc.id}/generate-summary",
        headers=auth_header(maintainer_token),
    )
    assert res.status_code == 200
    assert mock_gen.called
