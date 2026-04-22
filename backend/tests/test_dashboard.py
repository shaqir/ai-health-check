"""Tests for the dashboard router — metrics, trends, and drift alerts."""

from datetime import datetime, timedelta, timezone

from tests.conftest import auth_header
from app.models import AIService, Environment, SensitivityLabel, ConnectionLog, EvalRun


def _create_service(db):
    svc = AIService(
        name="Dashboard Test Service",
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


def test_metrics_empty_db(client, db, admin_token):
    res = client.get("/api/v1/dashboard/metrics", headers=auth_header(admin_token))
    assert res.status_code == 200
    data = res.json()
    assert data["active_services"] == 0
    assert data["avg_latency_ms"] == 0
    assert data["error_rate_pct"] == 0
    assert data["avg_quality_score"] == 0


def test_metrics_with_data(client, db, admin_token):
    svc = _create_service(db)
    now = datetime.now(timezone.utc)

    db.add(ConnectionLog(service_id=svc.id, latency_ms=150, status="success", tested_at=now - timedelta(hours=1)))
    db.add(ConnectionLog(service_id=svc.id, latency_ms=200, status="success", tested_at=now - timedelta(hours=2)))
    db.add(ConnectionLog(service_id=svc.id, latency_ms=100, status="failure", tested_at=now - timedelta(hours=3)))
    db.commit()

    res = client.get("/api/v1/dashboard/metrics", headers=auth_header(admin_token))
    assert res.status_code == 200
    data = res.json()
    assert data["active_services"] == 1
    assert data["avg_latency_ms"] > 0


def test_latency_trend(client, db, admin_token):
    svc = _create_service(db)
    now = datetime.now(timezone.utc)
    db.add(ConnectionLog(service_id=svc.id, latency_ms=150, status="success", tested_at=now - timedelta(hours=2)))
    db.commit()

    res = client.get("/api/v1/dashboard/latency-trend", headers=auth_header(admin_token))
    assert res.status_code == 200
    data = res.json()
    assert isinstance(data, list)
    assert all("time" in d and "ms" in d for d in data)


def test_quality_trend(client, db, admin_token):
    svc = _create_service(db)
    db.add(EvalRun(service_id=svc.id, quality_score=85.0, drift_flagged=False, run_type="manual"))
    db.add(EvalRun(service_id=svc.id, quality_score=90.0, drift_flagged=False, run_type="scheduled"))
    db.commit()

    res = client.get("/api/v1/dashboard/quality-trend", headers=auth_header(admin_token))
    assert res.status_code == 200
    data = res.json()
    assert isinstance(data, list)
    assert len(data) == 2


def test_error_trend(client, db, admin_token):
    res = client.get("/api/v1/dashboard/error-trend", headers=auth_header(admin_token))
    assert res.status_code == 200
    data = res.json()
    assert isinstance(data, list)
    assert len(data) == 7  # 7 days


def test_recent_evals(client, db, admin_token):
    svc = _create_service(db)
    db.add(EvalRun(service_id=svc.id, quality_score=88.0, drift_flagged=False, run_type="manual"))
    db.commit()

    res = client.get("/api/v1/dashboard/recent-evals", headers=auth_header(admin_token))
    assert res.status_code == 200
    data = res.json()
    assert len(data) >= 1
    assert "service_name" in data[0]
    assert "score" in data[0]


def test_drift_alerts_empty(client, db, admin_token):
    res = client.get("/api/v1/dashboard/drift-alerts", headers=auth_header(admin_token))
    assert res.status_code == 200
    assert res.json() == []


def test_drift_alerts_with_flagged(client, db, admin_token):
    svc = _create_service(db)
    now = datetime.now(timezone.utc)
    db.add(EvalRun(
        service_id=svc.id, quality_score=60.0, drift_flagged=True,
        run_type="manual", run_at=now - timedelta(hours=1),
    ))
    db.commit()

    res = client.get("/api/v1/dashboard/drift-alerts", headers=auth_header(admin_token))
    assert res.status_code == 200
    data = res.json()
    assert len(data) == 1
    assert data[0]["service_name"] == "Dashboard Test Service"


def test_unauthenticated_access_blocked(client):
    res = client.get("/api/v1/dashboard/metrics")
    assert res.status_code == 401


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


def test_env_filter_scopes_chart_endpoints(client, db, admin_token):
    """
    The env tabs on the Dashboard must actually scope the chart endpoints,
    not just the top metric cards. Was silently broken before — the Query
    param existed but wasn't passed through to the DB filter.
    """
    now = datetime.now(timezone.utc)
    prod_svc = _create_service_in(db, Environment.prod, "prod-svc")
    dev_svc = _create_service_in(db, Environment.dev, "dev-svc")

    # Two ConnectionLogs placed in different 4-hour buckets with wildly
    # different latencies — if the env filter works, prod's 1000ms must not
    # appear when we scope to dev.
    db.add(ConnectionLog(service_id=prod_svc.id, latency_ms=1000, status="success", tested_at=now - timedelta(hours=2)))
    db.add(ConnectionLog(service_id=dev_svc.id, latency_ms=50,   status="success", tested_at=now - timedelta(hours=6)))
    db.commit()

    h = auth_header(admin_token)

    dev_max = max(b["ms"] for b in client.get("/api/v1/dashboard/latency-trend?environment=dev",  headers=h).json())
    prod_max = max(b["ms"] for b in client.get("/api/v1/dashboard/latency-trend?environment=prod", headers=h).json())

    assert dev_max < 500,  f"prod 1000ms leaked into dev-scoped latency trend (max={dev_max})"
    assert prod_max > 500, f"prod-scoped latency trend missing its own 1000ms sample (max={prod_max})"


def test_error_rate_uses_drift_flags_not_connection_failures(client, db, admin_token):
    """
    Error Rate must track quality drift (EvalRun.drift_flagged), not infra
    failures (ConnectionLog.status=='failure'). The demo narrative
    "the server can be 100% up and still show 80% error rate" depends on
    this split — a regression to ConnectionLog-based computation would be
    invisible until the numbers stopped matching the talking point.
    """
    now = datetime.now(timezone.utc)
    svc = _create_service_in(db, Environment.prod, "metrics-svc")

    # 5 ping failures — pure infra failure, zero quality signal.
    for i in range(5):
        db.add(ConnectionLog(
            service_id=svc.id, latency_ms=0, status="failure",
            tested_at=now - timedelta(hours=i + 1),
        ))
    # 2 eval runs, neither drift-flagged — quality is fine.
    db.add(EvalRun(service_id=svc.id, quality_score=95.0, drift_flagged=False, run_type="manual", run_at=now - timedelta(hours=1)))
    db.add(EvalRun(service_id=svc.id, quality_score=90.0, drift_flagged=False, run_type="manual", run_at=now - timedelta(hours=2)))
    db.commit()

    h = auth_header(admin_token)
    data = client.get("/api/v1/dashboard/metrics", headers=h).json()
    assert data["error_rate_pct"] == 0.0, (
        f"Error Rate should be 0% (no drift flags; infra failures must not count), "
        f"got {data['error_rate_pct']}% — regressed to ConnectionLog semantics?"
    )

    # Add one drift-flagged run. Now 1 of 3 runs drifted → ~33.3%.
    db.add(EvalRun(service_id=svc.id, quality_score=50.0, drift_flagged=True, run_type="manual", run_at=now - timedelta(minutes=30)))
    db.commit()

    data = client.get("/api/v1/dashboard/metrics", headers=h).json()
    assert 33.0 <= data["error_rate_pct"] <= 34.0, (
        f"Expected ~33.3% (1 drift / 3 runs), got {data['error_rate_pct']}%"
    )


# ── Not-found contract ──────────────────────────────────────────────
# These endpoints used to return HTTP 200 with {"detail": "... not
# found"} so clients couldn't distinguish a missing resource from
# success. Both now raise HTTPException(404).

def test_api_call_trace_missing_id_returns_404(client, admin_token):
    res = client.get(
        "/api/v1/dashboard/api-calls/999999",
        headers=auth_header(admin_token),
    )
    assert res.status_code == 404
    assert res.json()["detail"] == "Call not found"


def test_acknowledge_missing_alert_returns_404(client, admin_token):
    res = client.post(
        "/api/v1/dashboard/alerts/999999/acknowledge",
        headers=auth_header(admin_token),
    )
    assert res.status_code == 404
    assert res.json()["detail"] == "Alert not found"
