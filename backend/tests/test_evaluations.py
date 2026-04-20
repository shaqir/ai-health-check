"""Tests for the evaluations router — test case CRUD, eval runs, drift detection."""

from unittest.mock import AsyncMock, patch

from tests.conftest import auth_header
from app.models import AIService, Environment, SensitivityLabel, EvalTestCase, EvalRun, EvalResult


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

@patch("app.services.eval_runner.run_eval_prompt", new_callable=AsyncMock)
@patch("app.services.eval_runner.score_factuality", new_callable=AsyncMock)
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


@patch("app.services.eval_runner.run_eval_prompt", new_callable=AsyncMock)
@patch("app.services.eval_runner.score_factuality", new_callable=AsyncMock)
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


# ── Drift alert auto-creation ──

@patch("app.services.eval_runner.score_factuality", new_callable=AsyncMock, return_value=30.0)
@patch("app.services.eval_runner.run_eval_prompt", new_callable=AsyncMock)
@patch("app.services.eval_runner.detect_hallucination", new_callable=AsyncMock, return_value=50.0)
def test_drift_critical_creates_alert(mock_halluc, mock_run, mock_score, client, db, admin_token):
    """Quality far below threshold must auto-create a critical Alert row."""
    from app.models import Alert

    mock_run.return_value = {"response_text": "wrong", "latency_ms": 100}

    svc = _create_service(db)
    db.add(EvalTestCase(
        service_id=svc.id, prompt="q", expected_output="a", category="factuality",
    ))
    db.commit()

    res = client.post(f"/api/v1/evaluations/run/{svc.id}", headers=auth_header(admin_token))
    assert res.status_code == 200
    assert res.json()["drift_flagged"] is True

    alerts = db.query(Alert).filter(Alert.alert_type == "drift").all()
    assert len(alerts) == 1
    assert alerts[0].severity == "critical"
    assert alerts[0].service_id == svc.id


@patch("app.services.eval_runner.score_factuality", new_callable=AsyncMock, return_value=95.0)
@patch("app.services.eval_runner.run_eval_prompt", new_callable=AsyncMock)
@patch("app.services.eval_runner.detect_hallucination", new_callable=AsyncMock, return_value=10.0)
def test_healthy_score_creates_no_alert(mock_halluc, mock_run, mock_score, client, db, admin_token):
    """No drift = no alert."""
    from app.models import Alert

    mock_run.return_value = {"response_text": "correct", "latency_ms": 100}

    svc = _create_service(db)
    db.add(EvalTestCase(
        service_id=svc.id, prompt="q", expected_output="a", category="factuality",
    ))
    db.commit()

    res = client.post(f"/api/v1/evaluations/run/{svc.id}", headers=auth_header(admin_token))
    assert res.status_code == 200
    assert res.json()["drift_flagged"] is False

    alerts = db.query(Alert).filter(Alert.alert_type == "drift").all()
    assert len(alerts) == 0


@patch("app.services.eval_runner.score_factuality", new_callable=AsyncMock, return_value=20.0)
@patch("app.services.eval_runner.run_eval_prompt", new_callable=AsyncMock)
@patch("app.services.eval_runner.detect_hallucination", new_callable=AsyncMock, return_value=60.0)
def test_drift_alert_creation_audited(mock_halluc, mock_run, mock_score, client, db, admin_token):
    """Alert creation must itself leave an audit trail."""
    from app.models import AuditLog

    mock_run.return_value = {"response_text": "wrong", "latency_ms": 100}

    svc = _create_service(db)
    db.add(EvalTestCase(
        service_id=svc.id, prompt="q", expected_output="a", category="factuality",
    ))
    db.commit()

    client.post(f"/api/v1/evaluations/run/{svc.id}", headers=auth_header(admin_token))

    alert_logs = db.query(AuditLog).filter(AuditLog.action == "alert_created").all()
    assert len(alert_logs) == 1
    assert alert_logs[0].target_table == "alerts"


# ── Priority regression guards ───────────────────────────────────────────────

def _create_service_in(db, env, name="Svc"):
    svc = AIService(
        name=name,
        owner="Team",
        environment=env,
        model_name="claude-sonnet-4-6",
        sensitivity_label=SensitivityLabel.internal,
        endpoint_url="https://example.com",
    )
    db.add(svc)
    db.commit()
    db.refresh(svc)
    return svc


def test_env_filter_scopes_eval_runs(client, db, admin_token):
    """
    GET /evaluations/runs?environment=<env> must actually scope results to
    that env, matching the Dashboard chart-endpoint behavior. Was missing
    entirely before the Evaluations parity sweep.
    """
    prod_svc = _create_service_in(db, Environment.prod, "prod-svc")
    dev_svc = _create_service_in(db, Environment.dev, "dev-svc")
    db.add(EvalRun(service_id=prod_svc.id, quality_score=90.0, drift_flagged=False, run_type="manual"))
    db.add(EvalRun(service_id=dev_svc.id, quality_score=85.0, drift_flagged=False, run_type="manual"))
    db.commit()

    h = auth_header(admin_token)

    all_runs = client.get("/api/v1/evaluations/runs", headers=h).json()
    assert {r["service_name"] for r in all_runs} >= {"prod-svc", "dev-svc"}, "baseline: both envs visible without filter"

    dev_runs = client.get("/api/v1/evaluations/runs?environment=dev", headers=h).json()
    assert {r["service_name"] for r in dev_runs} == {"dev-svc"}, (
        f"expected only dev-svc when env=dev, got {[r['service_name'] for r in dev_runs]}"
    )

    prod_runs = client.get("/api/v1/evaluations/runs?environment=prod", headers=h).json()
    assert {r["service_name"] for r in prod_runs} == {"prod-svc"}


def test_test_case_deletion_cascades_to_results(client, db, admin_token):
    """
    DELETE /evaluations/test-cases/{id} must clean up its EvalResult rows.
    Without the cascade, EvalResult.test_case_id (NOT NULL) would either
    orphan or fail under FK enforcement.
    """
    svc = _create_service(db)
    tc = EvalTestCase(service_id=svc.id, prompt="q", expected_output="a", category="factuality")
    db.add(tc)
    db.commit()
    db.refresh(tc)

    run = EvalRun(service_id=svc.id, quality_score=88.0, drift_flagged=False, run_type="manual")
    db.add(run)
    db.commit()
    db.refresh(run)

    result = EvalResult(
        eval_run_id=run.id,
        test_case_id=tc.id,
        response_text="answer",
        score=88.0,
        latency_ms=100,
        status="success",
    )
    db.add(result)
    db.commit()
    result_id = result.id

    res = client.delete(f"/api/v1/evaluations/test-cases/{tc.id}", headers=auth_header(admin_token))
    assert res.status_code == 200

    db.expire_all()
    assert db.query(EvalResult).filter(EvalResult.id == result_id).first() is None, (
        "EvalResult should be cascade-deleted with its parent test case"
    )
    # The EvalRun itself must survive — test-case deletion shouldn't wipe run history.
    assert db.query(EvalRun).filter(EvalRun.id == run.id).first() is not None
