"""
Call Trace endpoint coverage:

  GET /api/v1/settings/trace/activities  — grouped activities
  GET /api/v1/settings/trace/calls/{cid} — per-call drill-down (admin/maintainer only)

Tests cover:
  - Two calls sharing one correlation_id collapse into one activity
  - Rows without correlation_id are excluded (background jobs / legacy)
  - Reserved rows are excluded (in-flight, not finished)
  - Family filter works at the activity level
  - Drill-down is admin/maintainer-gated; viewer gets 403
  - Drill-down returns calls ordered oldest-first (chronological)
"""

from datetime import datetime, timedelta, timezone

import pytest

from app.models import APIUsageLog
from tests.conftest import auth_header


def _make_call(db, *, cid, caller, user_id, service_id=None, cost=0.001,
               latency=100, status="success", minutes_ago=0,
               prompt="hi", response="ok"):
    row = APIUsageLog(
        user_id=user_id, service_id=service_id,
        caller=caller, model="claude-sonnet-4-6-20250415",
        input_tokens=10, output_tokens=5, total_tokens=15,
        estimated_cost_usd=cost, latency_ms=latency,
        status=status, safety_flags="", risk_score=0,
        prompt_text=prompt, response_text=response,
        correlation_id=cid,
        timestamp=datetime.now(timezone.utc) - timedelta(minutes=minutes_ago),
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


def test_activities_group_by_correlation_id(client, admin_user, admin_token, db):
    """Two api_usage_log rows sharing one correlation_id must collapse
    into ONE activity row with call_count=2 and summed cost/latency."""
    cid = "11111111-1111-1111-1111-111111111111"
    _make_call(db, cid=cid, caller="run_eval_prompt", user_id=admin_user.id, cost=0.01, latency=500)
    _make_call(db, cid=cid, caller="judge_response",  user_id=admin_user.id, cost=0.001, latency=200)

    res = client.get("/api/v1/settings/trace/activities", headers=auth_header(admin_token))
    assert res.status_code == 200
    body = res.json()

    assert body["total"] == 1, f"expected 1 grouped activity, got {body['total']}: {body}"
    row = body["activities"][0]
    assert row["correlation_id"] == cid
    assert row["call_count"] == 2
    assert row["family"] == "evaluation"
    assert row["family_label"] == "Evaluation run"
    assert abs(row["total_cost_usd"] - 0.011) < 1e-6
    assert row["total_latency_ms"] == 700.0


def test_activities_exclude_null_correlation_id(client, admin_user, admin_token, db):
    """Rows where correlation_id IS NULL (background scheduler, legacy)
    must NOT appear in the grouped trace view."""
    _make_call(db, cid=None, caller="run_eval_prompt", user_id=admin_user.id)

    res = client.get("/api/v1/settings/trace/activities", headers=auth_header(admin_token))
    assert res.status_code == 200
    assert res.json()["total"] == 0


def test_activities_exclude_reserved_rows(client, admin_user, admin_token, db):
    """In-flight reservation rows (status='reserved') must not count as
    completed activities."""
    _make_call(db, cid="2"*36, caller="run_eval_prompt", user_id=admin_user.id, status="reserved")

    res = client.get("/api/v1/settings/trace/activities", headers=auth_header(admin_token))
    assert res.status_code == 200
    assert res.json()["total"] == 0


def test_activities_family_filter(client, admin_user, admin_token, db):
    """?family=connection_test must surface only connection-test activities."""
    _make_call(db, cid="a"*36, caller="test_connection",  user_id=admin_user.id)
    _make_call(db, cid="b"*36, caller="run_eval_prompt",  user_id=admin_user.id)

    res = client.get(
        "/api/v1/settings/trace/activities?family=connection_test",
        headers=auth_header(admin_token),
    )
    assert res.status_code == 200
    body = res.json()
    assert body["total"] == 1
    assert body["activities"][0]["family"] == "connection_test"


def test_calls_drilldown_returns_chronological_order(client, admin_user, admin_token, db):
    """The drill-down endpoint must return calls oldest-first so the UI
    can render them as a timeline."""
    cid = "c"*36
    # Insert out of order to prove the endpoint sorts.
    _make_call(db, cid=cid, caller="judge_response",  user_id=admin_user.id, minutes_ago=0)
    _make_call(db, cid=cid, caller="run_eval_prompt", user_id=admin_user.id, minutes_ago=5)

    res = client.get(f"/api/v1/settings/trace/calls/{cid}", headers=auth_header(admin_token))
    assert res.status_code == 200
    calls = res.json()["calls"]
    assert [c["caller"] for c in calls] == ["run_eval_prompt", "judge_response"]


def test_calls_drilldown_includes_prompt_and_response(client, admin_user, admin_token, db):
    """The drill-down IS the point of the whole feature — prompt/response
    text must come through so the user can see what was actually sent."""
    cid = "d"*36
    _make_call(
        db, cid=cid, caller="generate_summary", user_id=admin_user.id,
        prompt="Summarize this incident: DB latency up 200%",
        response="STAKEHOLDER UPDATE: DB connection pool exhausted...",
    )

    res = client.get(f"/api/v1/settings/trace/calls/{cid}", headers=auth_header(admin_token))
    assert res.status_code == 200
    calls = res.json()["calls"]
    assert len(calls) == 1
    assert "DB latency" in calls[0]["prompt_text"]
    assert "DB connection pool" in calls[0]["response_text"]


def test_calls_drilldown_blocks_viewers(client, admin_user, viewer_token, db):
    """Viewers cannot see prompt/response text — that's PII-adjacent.
    Activity list is open; drill-down is admin/maintainer-only."""
    cid = "e"*36
    _make_call(db, cid=cid, caller="run_eval_prompt", user_id=admin_user.id,
               prompt="confidential query")

    res = client.get(f"/api/v1/settings/trace/calls/{cid}", headers=auth_header(viewer_token))
    assert res.status_code == 403


def test_calls_drilldown_404_for_unknown_cid(client, admin_token):
    res = client.get(
        "/api/v1/settings/trace/calls/nonexistent-cid",
        headers=auth_header(admin_token),
    )
    assert res.status_code == 404
