"""Tests for the evaluations router — test case CRUD, eval runs, drift detection."""

from unittest.mock import AsyncMock, patch

from tests.conftest import auth_header
from app.models import AIService, Environment, SensitivityLabel, EvalTestCase, EvalRun


def _create_service(db):
    """Helper to create a test service."""
    svc = AIService(
        name="Test Bot",
        owner="Team",
        environment=Environment.prod,
        model_name="claude-sonnet-4-6-20250415",
        sensitivity_label=SensitivityLabel.internal,
        endpoint_url="https://example.com",
    )
    db.add(svc)
    db.commit()
    db.refresh(svc)
    return svc


# ── Test Case CRUD ──

def test_create_test_case(client, db, admin_token):
    svc = _create_service(db)
    res = client.post("/api/v1/evaluations/test-cases", json={
        "service_id": svc.id,
        "prompt": "What is 2+2?",
        "expected_output": "4",
        "category": "factuality",
    }, headers=auth_header(admin_token))
    assert res.status_code == 200
    data = res.json()
    assert data["prompt"] == "What is 2+2?"
    assert data["category"] == "factuality"


def test_create_test_case_invalid_category(client, db, admin_token):
    svc = _create_service(db)
    res = client.post("/api/v1/evaluations/test-cases", json={
        "service_id": svc.id,
        "prompt": "test",
        "expected_output": "test",
        "category": "invalid",
    }, headers=auth_header(admin_token))
    assert res.status_code == 400


def test_list_test_cases(client, db, admin_token):
    svc = _create_service(db)
    db.add(EvalTestCase(service_id=svc.id, prompt="p1", expected_output="e1", category="factuality"))
    db.add(EvalTestCase(service_id=svc.id, prompt="p2", expected_output="e2", category="format_json"))
    db.commit()

    res = client.get("/api/v1/evaluations/test-cases", headers=auth_header(admin_token))
    assert res.status_code == 200
    assert len(res.json()) == 2


def test_list_test_cases_filter_by_service(client, db, admin_token):
    svc1 = _create_service(db)
    svc2 = AIService(name="Other", owner="T", environment=Environment.dev,
                     model_name="m", sensitivity_label=SensitivityLabel.public)
    db.add(svc2)
    db.commit()
    db.refresh(svc2)

    db.add(EvalTestCase(service_id=svc1.id, prompt="p1", expected_output="e1", category="factuality"))
    db.add(EvalTestCase(service_id=svc2.id, prompt="p2", expected_output="e2", category="factuality"))
    db.commit()

    res = client.get(f"/api/v1/evaluations/test-cases?service_id={svc1.id}", headers=auth_header(admin_token))
    assert len(res.json()) == 1


def test_delete_test_case(client, db, admin_token):
    svc = _create_service(db)
    tc = EvalTestCase(service_id=svc.id, prompt="p", expected_output="e", category="factuality")
    db.add(tc)
    db.commit()
    db.refresh(tc)

    res = client.delete(f"/api/v1/evaluations/test-cases/{tc.id}", headers=auth_header(admin_token))
    assert res.status_code == 200


def test_viewer_cannot_create_test_case(client, db, viewer_token):
    svc = _create_service(db)
    res = client.post("/api/v1/evaluations/test-cases", json={
        "service_id": svc.id,
        "prompt": "test",
        "expected_output": "test",
        "category": "factuality",
    }, headers=auth_header(viewer_token))
    assert res.status_code == 403


# ── Eval Runs ──

@patch("app.routers.evaluations.run_eval_prompt", new_callable=AsyncMock)
@patch("app.routers.evaluations.score_factuality", new_callable=AsyncMock)
def test_run_evaluation(mock_score, mock_eval, client, db, admin_token):
    mock_eval.return_value = {"response_text": "Paris is the capital of France.", "latency_ms": 150}
    mock_score.return_value = 90.0

    svc = _create_service(db)
    db.add(EvalTestCase(service_id=svc.id, prompt="Capital of France?", expected_output="Paris", category="factuality"))
    db.commit()

    res = client.post(f"/api/v1/evaluations/run/{svc.id}", headers=auth_header(admin_token))
    assert res.status_code == 200
    data = res.json()
    assert data["quality_score"] == 90.0
    assert data["drift_flagged"] is False
    assert len(data["results"]) == 1


@patch("app.routers.evaluations.run_eval_prompt", new_callable=AsyncMock)
@patch("app.routers.evaluations.score_factuality", new_callable=AsyncMock)
def test_run_evaluation_drift_detected(mock_score, mock_eval, client, db, admin_token):
    mock_eval.return_value = {"response_text": "Wrong answer", "latency_ms": 200}
    mock_score.return_value = 40.0

    svc = _create_service(db)
    db.add(EvalTestCase(service_id=svc.id, prompt="test", expected_output="correct", category="factuality"))
    db.commit()

    res = client.post(f"/api/v1/evaluations/run/{svc.id}", headers=auth_header(admin_token))
    assert res.status_code == 200
    assert res.json()["drift_flagged"] is True


def test_run_evaluation_no_test_cases(client, db, admin_token):
    svc = _create_service(db)
    res = client.post(f"/api/v1/evaluations/run/{svc.id}", headers=auth_header(admin_token))
    assert res.status_code == 400


def test_list_eval_runs(client, db, admin_token):
    svc = _create_service(db)
    db.add(EvalRun(service_id=svc.id, quality_score=85.0, drift_flagged=False, run_type="manual"))
    db.commit()

    res = client.get("/api/v1/evaluations/runs", headers=auth_header(admin_token))
    assert res.status_code == 200
    assert len(res.json()) >= 1


def test_drift_check(client, db, admin_token):
    svc = _create_service(db)
    res = client.get(f"/api/v1/evaluations/drift-check/{svc.id}", headers=auth_header(admin_token))
    assert res.status_code == 200
    data = res.json()
    assert "drift_detected" in data
    assert "threshold" in data
