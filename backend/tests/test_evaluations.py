"""Tests for the evaluations router — test case CRUD, eval runs, drift detection."""

from datetime import datetime, timedelta, timezone
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
@patch("app.services.eval_runner.judge_response", new_callable=AsyncMock)
def test_run_evaluation(mock_judge, mock_eval, client, db, admin_token):
    # judge_response now returns both rubrics in one call. `hallucination:
    # None` means "no measurable signal" for that rubric — excluded from
    # averaging, same contract as the old two-call path.
    mock_eval.return_value = {"response_text": "Paris is the capital of France.", "latency_ms": 150}
    mock_judge.return_value = {"factuality": 90.0, "hallucination": None}

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
@patch("app.services.eval_runner.judge_response", new_callable=AsyncMock)
def test_run_evaluation_drift_detected(mock_judge, mock_eval, client, db, admin_token):
    mock_eval.return_value = {"response_text": "Wrong answer", "latency_ms": 200}
    mock_judge.return_value = {"factuality": 40.0, "hallucination": None}

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


def test_drift_check_reports_output_distribution_psi(client, db, admin_token):
    svc = _create_service(db)
    tc = EvalTestCase(
        service_id=svc.id,
        prompt="Summarize the case",
        expected_output="short summary",
        category="factuality",
    )
    db.add(tc)
    db.commit()
    db.refresh(tc)

    now = datetime.now(timezone.utc)
    previous = EvalRun(
        service_id=svc.id,
        quality_score=92.0,
        drift_flagged=False,
        run_type="manual",
        run_status="complete",
        run_at=now - timedelta(days=1),
    )
    current = EvalRun(
        service_id=svc.id,
        quality_score=91.0,
        drift_flagged=False,
        run_type="manual",
        run_status="complete",
        run_at=now,
    )
    db.add_all([previous, current])
    db.commit()
    db.refresh(previous)
    db.refresh(current)

    db.add_all([
        EvalResult(
            eval_run_id=previous.id,
            test_case_id=tc.id,
            response_text="OK.",
            score=92.0,
            status="success",
        ),
        EvalResult(
            eval_run_id=current.id,
            test_case_id=tc.id,
            response_text=("Detailed paragraph. " * 50),
            score=91.0,
            status="success",
        ),
    ])
    db.commit()

    res = client.get(
        f"/api/v1/evaluations/drift-check/{svc.id}?window=2",
        headers=auth_header(admin_token),
    )

    assert res.status_code == 200
    body = res.json()
    psi = body["output_distribution_drift"]
    assert psi["method"] == "psi_response_length_buckets"
    assert psi["severity"] == "critical"
    assert psi["psi_score"] >= 0.25
    assert body["drift_detected"] is True


def test_list_eval_runs(client, db, admin_token):
    svc = _create_service(db)
    db.add(EvalRun(service_id=svc.id, quality_score=85.0, drift_flagged=False, run_type="manual"))
    db.commit()

    res = client.get("/api/v1/evaluations/runs", headers=auth_header(admin_token))
    assert res.status_code == 200
    assert len(res.json()) >= 1


def test_get_eval_run_preserves_run_status(client, db, admin_token):
    """GET /runs/{id} must echo the persisted run_status.

    Before this was guarded, the endpoint constructed EvalRunResponse
    without passing run_status, so Pydantic's schema default ("complete")
    was returned for every row — an "incomplete" run (all cases errored
    or the judge refused every one) silently looked complete.
    """
    svc = _create_service(db)
    # Persist a run with the honest-tri-state INCOMPLETE value.
    run = EvalRun(
        service_id=svc.id, quality_score=0.0, drift_flagged=False,
        run_type="manual", run_status="incomplete",
        judge_model="claude-haiku-4-5-20251001",
    )
    db.add(run)
    db.commit()
    db.refresh(run)

    res = client.get(f"/api/v1/evaluations/runs/{run.id}", headers=auth_header(admin_token))
    assert res.status_code == 200
    body = res.json()
    assert body["run_status"] == "incomplete", (
        f"GET /runs/{{id}} must echo DB run_status; got {body['run_status']!r}"
    )
    # Regression guard on the other fields too — we don't want to
    # accidentally drop anything else from the response.
    assert body["quality_score"] == 0.0
    assert body["judge_model"] == "claude-haiku-4-5-20251001"


def test_get_eval_run_round_trips_complete_status(client, db, admin_token):
    """Regression guard the happy path stays unchanged."""
    svc = _create_service(db)
    run = EvalRun(
        service_id=svc.id, quality_score=87.5, drift_flagged=False,
        run_type="scheduled", run_status="complete",
    )
    db.add(run)
    db.commit()
    db.refresh(run)

    res = client.get(f"/api/v1/evaluations/runs/{run.id}", headers=auth_header(admin_token))
    assert res.status_code == 200
    assert res.json()["run_status"] == "complete"


# ── Cost preview per-model pricing ─────────────────────────────────

def _create_service_with_model(db, model_name: str, name: str = "Svc"):
    svc = AIService(
        name=name, owner="Team", environment=Environment.prod,
        model_name=model_name, sensitivity_label=SensitivityLabel.internal,
        endpoint_url="https://example.com",
    )
    db.add(svc)
    db.commit()
    db.refresh(svc)
    return svc


def _seed_two_factuality_cases(db, service_id: int):
    db.add_all([
        EvalTestCase(service_id=service_id, prompt="q1",
                     expected_output="a1", category="factuality"),
        EvalTestCase(service_id=service_id, prompt="q2",
                     expected_output="a2", category="factuality"),
    ])
    db.commit()


def test_cost_preview_sonnet_uses_sonnet_rates(client, db, admin_token):
    """Regression guard the Sonnet happy path stays unchanged.

    2 factuality cases → api_calls = test_cases + factuality_count = 4
    est_input_tokens = 4 * 500 = 2000
    est_output_tokens = 4 * 200 = 800
    Sonnet rates: $3/M input, $15/M output
    Expected: (2000/1e6)*3 + (800/1e6)*15 = 0.006 + 0.012 = 0.018 USD
    """
    svc = _create_service_with_model(db, "claude-sonnet-4-6", name="SonnetSvc")
    _seed_two_factuality_cases(db, svc.id)

    res = client.get(
        f"/api/v1/evaluations/cost-preview/{svc.id}",
        headers=auth_header(admin_token),
    )
    assert res.status_code == 200
    body = res.json()
    assert body["api_calls"] == 4
    assert body["estimated_cost_usd"] == 0.018


def test_cost_preview_haiku_uses_haiku_rates(client, db, admin_token):
    """Haiku service must be priced at Haiku's $1/$5, not Sonnet's $3/$15.

    Pre-fix behaviour: used hardcoded Sonnet constants regardless of
    the service's actual model_name — Haiku services were over-
    estimated by ~3×.

    Same workload as above (4 api_calls, 2000 input / 800 output
    tokens) should yield: (2000/1e6)*1 + (800/1e6)*5 = 0.002 + 0.004
    = 0.006 USD  (exactly 1/3 of the Sonnet cost).
    """
    svc = _create_service_with_model(db, "claude-haiku-4-5", name="HaikuSvc")
    _seed_two_factuality_cases(db, svc.id)

    res = client.get(
        f"/api/v1/evaluations/cost-preview/{svc.id}",
        headers=auth_header(admin_token),
    )
    assert res.status_code == 200
    body = res.json()
    assert body["api_calls"] == 4
    assert body["estimated_cost_usd"] == 0.006, (
        f"Haiku should cost 1/3 of Sonnet; got {body['estimated_cost_usd']} "
        f"— still using hardcoded Sonnet rates?"
    )


def test_cost_preview_dated_model_id_normalizes_to_same_rate(client, db, admin_token):
    """A dated snapshot (claude-sonnet-4-6-20250415) must price identically
    to the undated family id. Pricing lookup uses normalize_model_id
    which strips the -YYYYMMDD suffix."""
    svc = _create_service_with_model(
        db, "claude-sonnet-4-6-20250415", name="DatedSnapshotSvc",
    )
    _seed_two_factuality_cases(db, svc.id)

    res = client.get(
        f"/api/v1/evaluations/cost-preview/{svc.id}",
        headers=auth_header(admin_token),
    )
    assert res.status_code == 200
    assert res.json()["estimated_cost_usd"] == 0.018  # same as undated Sonnet


def test_drift_check(client, db, admin_token):
    svc = _create_service(db)
    res = client.get(f"/api/v1/evaluations/drift-check/{svc.id}", headers=auth_header(admin_token))
    assert res.status_code == 200
    data = res.json()
    assert "drift_detected" in data
    assert "threshold" in data


def test_drift_check_with_runs_exercises_per_test_breakdown(client, db, admin_token):
    """
    drift-check's per_test_case_breakdown path queries EvalResult. When we
    dropped EvalResult from the evaluations.py import list during the
    eval_runner refactor, the endpoint 500'd — but the bare test_drift_check
    above dodges that path because it has no runs. This test creates runs +
    results so the full endpoint logic runs, catching a missing-import or
    broken query regression immediately.
    """
    svc = _create_service(db)

    tc1 = EvalTestCase(service_id=svc.id, prompt="q1", expected_output="a1", category="factuality")
    tc2 = EvalTestCase(service_id=svc.id, prompt="q2", expected_output="a2", category="format_json")
    db.add_all([tc1, tc2])
    db.commit()
    db.refresh(tc1); db.refresh(tc2)

    run = EvalRun(service_id=svc.id, quality_score=60.0, drift_flagged=True, run_type="manual")
    db.add(run)
    db.commit()
    db.refresh(run)

    db.add(EvalResult(eval_run_id=run.id, test_case_id=tc1.id, response_text="r1", score=80.0, latency_ms=100, status="success"))
    db.add(EvalResult(eval_run_id=run.id, test_case_id=tc2.id, response_text="r2", score=40.0, latency_ms=120, status="success"))
    db.commit()

    res = client.get(f"/api/v1/evaluations/drift-check/{svc.id}", headers=auth_header(admin_token))
    assert res.status_code == 200, f"drift-check must not 500 when runs+results exist: {res.text}"

    data = res.json()
    assert data["current_score"] == 60.0
    assert data["drift_detected"] is True
    breakdown = data.get("per_test_case_breakdown")
    assert breakdown and len(breakdown) == 2, "per_test_case_breakdown must iterate EvalResult rows"
    assert {b["category"] for b in breakdown} == {"factuality", "format_json"}


# ── Drift alert auto-creation ──

@patch(
    "app.services.eval_runner.judge_response",
    new_callable=AsyncMock,
    return_value={"factuality": 30.0, "hallucination": 50.0},
)
@patch("app.services.eval_runner.run_eval_prompt", new_callable=AsyncMock)
def test_drift_critical_creates_alert(mock_run, mock_judge, client, db, admin_token):
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


@patch(
    "app.services.eval_runner.judge_response",
    new_callable=AsyncMock,
    return_value={"factuality": 95.0, "hallucination": 10.0},
)
@patch("app.services.eval_runner.run_eval_prompt", new_callable=AsyncMock)
def test_healthy_score_creates_no_alert(mock_run, mock_judge, client, db, admin_token):
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


@patch(
    "app.services.eval_runner.judge_response",
    new_callable=AsyncMock,
    return_value={"factuality": 20.0, "hallucination": 60.0},
)
@patch("app.services.eval_runner.run_eval_prompt", new_callable=AsyncMock)
def test_drift_alert_creation_audited(mock_run, mock_judge, client, db, admin_token):
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
