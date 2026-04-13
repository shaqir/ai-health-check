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
