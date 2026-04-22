"""
Regression for the dual-model settings refactor.

Before: /dashboard/settings returned one "ai_model" field (always Sonnet,
never mentioning Haiku) and one hardcoded "pricing" pair ($3/$15 — wrong
for Haiku calls). That made the two-model architecture invisible on the
page that's supposed to document it.

After: "models.actor" + "models.judge" with distinct pricing sourced from
llm_client._PRICING. /api-usage also surfaces today's calls grouped by
model so the UI can show a per-model activity chip.
"""

from datetime import datetime, timedelta, timezone

from app.models import APIUsageLog
from tests.conftest import auth_header


def _make_call(db, *, model, cost, status="success", minutes_ago=5, cid="cid-test"):
    db.add(APIUsageLog(
        user_id=None, caller="run_eval_prompt", model=model,
        input_tokens=10, output_tokens=5, total_tokens=15,
        estimated_cost_usd=cost, latency_ms=100.0, status=status,
        correlation_id=cid,
        timestamp=datetime.now(timezone.utc) - timedelta(minutes=minutes_ago),
    ))
    db.commit()


# ── /dashboard/settings ─────────────────────────────────────────────

def test_settings_returns_dual_models(client, admin_token):
    """The new shape must include models.actor + models.judge — a flat
    'ai_model' field is the old shape and must NOT come back."""
    res = client.get("/api/v1/dashboard/settings", headers=auth_header(admin_token))
    assert res.status_code == 200
    body = res.json()

    # Hard guard against the old shape. If someone re-adds it for backward
    # compat, this test fails and forces the conversation.
    assert "ai_model" not in body, "legacy 'ai_model' field must be removed — use 'models.actor' instead"
    assert "pricing" not in body, "legacy flat 'pricing' field must be removed — pricing now lives per-model"

    # New shape
    assert "models" in body
    assert set(body["models"].keys()) == {"actor", "judge"}

    actor = body["models"]["actor"]
    assert actor["role"] == "actor"
    assert actor["provider"] == "Anthropic"
    assert "sonnet" in actor["id"].lower(), "actor must default to a Sonnet-family model"
    assert "pricing" in actor and actor["pricing"]["input_per_million_usd"] > 0

    judge = body["models"]["judge"]
    assert judge["role"] == "judge"
    assert "haiku" in judge["id"].lower(), "judge must default to a Haiku-family model"
    assert "pricing" in judge

    # Judge must be strictly cheaper — that's the point of the two-tier design.
    # If this ever inverts, the cost story on the page becomes a lie.
    assert judge["pricing"]["input_per_million_usd"] < actor["pricing"]["input_per_million_usd"]
    assert judge["pricing"]["output_per_million_usd"] < actor["pricing"]["output_per_million_usd"]


def test_settings_returns_runtime_config(client, admin_token):
    """Global runtime fields live under 'runtime', not nested under a
    single model (because they apply to all models)."""
    res = client.get("/api/v1/dashboard/settings", headers=auth_header(admin_token))
    body = res.json()
    assert "runtime" in body
    assert body["runtime"]["max_tokens"] > 0
    assert body["runtime"]["timeout_seconds"] > 0


# ── /dashboard/api-usage ────────────────────────────────────────────

def test_api_usage_includes_breakdown_by_model(client, admin_token, db):
    """breakdown_by_model must attribute today's calls + cost to each
    model separately — the Models page chip renders from this."""
    _make_call(db, model="claude-sonnet-4-6-20250415", cost=0.008)
    _make_call(db, model="claude-sonnet-4-6-20250415", cost=0.008)
    _make_call(db, model="claude-haiku-4-5-20251001",  cost=0.001)

    res = client.get("/api/v1/dashboard/api-usage", headers=auth_header(admin_token))
    assert res.status_code == 200
    body = res.json()

    assert "breakdown_by_model" in body
    by_model = body["breakdown_by_model"]
    assert by_model["claude-sonnet-4-6-20250415"]["calls"] == 2
    assert abs(by_model["claude-sonnet-4-6-20250415"]["cost_usd"] - 0.016) < 1e-6
    assert by_model["claude-haiku-4-5-20251001"]["calls"] == 1
    assert abs(by_model["claude-haiku-4-5-20251001"]["cost_usd"] - 0.001) < 1e-6


def test_api_usage_breakdown_by_model_excludes_reserved(client, admin_token, db):
    """In-flight reservations (status='reserved') must not inflate the
    per-model counts — those calls haven't completed yet."""
    _make_call(db, model="claude-sonnet-4-6-20250415", cost=0.008, status="success")
    _make_call(db, model="claude-sonnet-4-6-20250415", cost=0.050, status="reserved")

    res = client.get("/api/v1/dashboard/api-usage", headers=auth_header(admin_token))
    by_model = res.json()["breakdown_by_model"]
    assert by_model["claude-sonnet-4-6-20250415"]["calls"] == 1, "reserved row must not count"
    assert abs(by_model["claude-sonnet-4-6-20250415"]["cost_usd"] - 0.008) < 1e-6
