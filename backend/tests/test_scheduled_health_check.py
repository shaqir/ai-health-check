"""
Scheduler resilience — `scheduled_health_check` must not lose a whole
tick's worth of monitoring data when one service's probe misbehaves.

Before the fix, the function committed once at the end of the loop.
A single unhandled exception mid-loop (after N services had already
been probed) rolled back every ConnectionLog + Telemetry row the
scheduler had staged. Five minutes of observability data for the rest
of the fleet disappeared silently into a stdout `print`.

After the fix:
  - each service's probe commits its own ConnectionLog + Telemetry;
  - any exception raised by one service is logged via `logging.exception`
    and the loop continues with the next service.

Tests call the function directly (it's a plain sync function — no
APScheduler instance or thread is involved).
"""

from unittest.mock import patch, MagicMock

import httpx
import pytest

from app.main import scheduled_health_check
from app.models import (
    AIService,
    ConnectionLog,
    Environment,
    SensitivityLabel,
    Telemetry,
)
from tests.conftest import TestSession


@pytest.fixture(autouse=True)
def _point_scheduler_at_test_db(monkeypatch):
    """The scheduler creates its own session via `app.database.SessionLocal`
    which, untouched, points at the real aiops.db. Repoint it at the
    test engine's session factory so our seeded services are visible
    and the rows the scheduler writes land in the test DB."""
    monkeypatch.setattr("app.main.SessionLocal", TestSession)


def _seed_active_service(db, name: str, endpoint_url: str = "https://ok.example.com") -> AIService:
    svc = AIService(
        name=name, owner="T", environment=Environment.dev,
        model_name="m", sensitivity_label=SensitivityLabel.public,
        endpoint_url=endpoint_url, is_active=True,
    )
    db.add(svc)
    db.commit()
    db.refresh(svc)
    return svc


def _counts(db, service_id: int) -> tuple[int, int]:
    """Count ConnectionLog + Telemetry rows for a service."""
    return (
        db.query(ConnectionLog).filter(ConnectionLog.service_id == service_id).count(),
        db.query(Telemetry).filter(Telemetry.service_id == service_id).count(),
    )


def _fake_response(status_code: int, text: str = "OK"):
    resp = MagicMock()
    resp.status_code = status_code
    resp.text = text
    return resp


# ── Happy path — baseline that existing behaviour survives ──────────

def test_happy_path_both_services_get_logs_and_telemetry(client, db):
    """Two active services, both respond 200 -> each gets its own
    ConnectionLog + Telemetry row after one tick."""
    svc_a = _seed_active_service(db, "A", "https://a.example.com")
    svc_b = _seed_active_service(db, "B", "https://b.example.com")

    fake_client = MagicMock()
    fake_client.__enter__.return_value = fake_client
    fake_client.__exit__.return_value = False
    fake_client.get.return_value = _fake_response(200, "healthy")

    with patch("app.main.httpx.Client", return_value=fake_client):
        scheduled_health_check()

    db.expire_all()
    logs_a, tel_a = _counts(db, svc_a.id)
    logs_b, tel_b = _counts(db, svc_b.id)

    assert logs_a == 1 and tel_a == 1, "service A's rows should persist"
    assert logs_b == 1 and tel_b == 1, "service B's rows should persist"


# ── Isolation — one flaky service must not wipe the others ─────────

def test_one_flaky_service_does_not_wipe_other_services_rows(client, db, monkeypatch):
    """service A probes cleanly. service B's httpx call also succeeds,
    but constructing its ConnectionLog row raises — simulating the
    class of failures that escape the scheduler's inner try/except
    (DB-layer errors, constraint violations, etc.) and land in the
    outer handler.

    Before the fix: the outer handler rolled back the WHOLE session,
    taking service A's already-added rows with it. 10 minutes of
    monitoring disappears silently into stdout.

    After the fix: A's rows are committed per-service inside the loop,
    so B's failure can't retroactively wipe them.
    """
    svc_a = _seed_active_service(db, "A", "https://a.example.com")
    svc_b = _seed_active_service(db, "B", "https://b.example.com")

    # Both probes return 200 — the failure surfaces AFTER the probe in
    # the ConnectionLog construction, so it escapes the inner except.
    fake_client = MagicMock()
    fake_client.__enter__.return_value = fake_client
    fake_client.__exit__.return_value = False
    fake_client.get.return_value = _fake_response(200, "healthy")

    import app.main as main_module
    real_ConnectionLog = main_module.ConnectionLog

    def construct_or_raise_for_b(**kwargs):
        if kwargs.get("service_id") == svc_b.id:
            raise RuntimeError("simulated ORM error constructing ConnectionLog")
        return real_ConnectionLog(**kwargs)

    monkeypatch.setattr("app.main.ConnectionLog", construct_or_raise_for_b)

    with patch("app.main.httpx.Client", return_value=fake_client):
        scheduled_health_check()

    db.expire_all()
    logs_a, tel_a = _counts(db, svc_a.id)
    logs_b, tel_b = _counts(db, svc_b.id)

    assert logs_a == 1, "service A's ConnectionLog must survive B's failure"
    assert tel_a == 1, "service A's Telemetry must survive B's failure"
    # B's row construction raised, so nothing committed for B.
    assert logs_b == 0, "service B should have no row (its write blew up)"
    assert tel_b == 0, "service B should have no telemetry either"


# ── SSRF-blocked mid-loop also isolates cleanly ────────────────────

def test_ssrf_block_on_one_service_still_commits_others(client, db, monkeypatch):
    """Service A resolves to a public IP (allowed). Service B resolves
    to 10.x (blocked). B gets a 'blocked' ConnectionLog; A gets its
    regular probe row. The SSRF-block path and the success path must
    both commit independently."""
    import socket

    def selective_getaddrinfo(host, port, *args, **kwargs):
        if "a.example.com" in host:
            return [(socket.AF_INET, socket.SOCK_STREAM, 6, "", ("1.1.1.1", port or 0))]
        if "b.example.com" in host:
            return [(socket.AF_INET, socket.SOCK_STREAM, 6, "", ("10.0.0.5", port or 0))]
        return [(socket.AF_INET, socket.SOCK_STREAM, 6, "", ("1.1.1.1", port or 0))]

    monkeypatch.setattr(socket, "getaddrinfo", selective_getaddrinfo)

    svc_a = _seed_active_service(db, "A", "https://a.example.com")
    svc_b = _seed_active_service(db, "B", "https://b.example.com")

    fake_client = MagicMock()
    fake_client.__enter__.return_value = fake_client
    fake_client.__exit__.return_value = False
    fake_client.get.return_value = _fake_response(200, "healthy")

    with patch("app.main.httpx.Client", return_value=fake_client):
        scheduled_health_check()

    db.expire_all()
    logs_a, tel_a = _counts(db, svc_a.id)
    logs_b, tel_b = _counts(db, svc_b.id)

    assert logs_a == 1, "A's probe result should persist"
    assert tel_a == 1, "A's telemetry should persist"

    # B's SSRF-blocked branch writes a ConnectionLog but no Telemetry
    # (existing behaviour preserved — no latency to record).
    assert logs_b == 1, "B should have a 'blocked' ConnectionLog"
    b_log = db.query(ConnectionLog).filter(ConnectionLog.service_id == svc_b.id).first()
    assert b_log.status == "failure"
    assert "blocked" in b_log.response_snippet.lower()
    assert tel_b == 0, "SSRF block writes no telemetry"
