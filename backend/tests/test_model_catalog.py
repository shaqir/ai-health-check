"""
Model catalog + pricing normalization regression.

Two concerns live here:
  1. normalize_model_id strips Anthropic's -YYYYMMDD date suffixes so
     claude-sonnet-4-6 and claude-sonnet-4-6-20250415 resolve to the
     same catalog entry (no more "lucky fallback" coincidences).
  2. GET /api/v1/settings/models/catalog returns the dropdown's source
     of truth: id, family, tier, label, recommended_for, pricing.
"""

from app.services import llm_client
from app.services.model_catalog import (
    CATALOG, find_model, normalize_model_id, pricing_for,
)
from tests.conftest import auth_header


# ── Normalization ───────────────────────────────────────────────────

def test_normalize_strips_date_suffix():
    assert normalize_model_id("claude-sonnet-4-6-20250415") == "claude-sonnet-4-6"
    assert normalize_model_id("claude-haiku-4-5-20251001") == "claude-haiku-4-5"


def test_normalize_idempotent_on_bare_id():
    """Undated ids must pass through unchanged — critical for round-trip
    safety when the UI writes dropdown values back to the DB."""
    assert normalize_model_id("claude-sonnet-4-6") == "claude-sonnet-4-6"


def test_normalize_handles_empty_safely():
    assert normalize_model_id("") == ""
    assert normalize_model_id(None) == ""


def test_normalize_does_not_strip_non_date_suffix():
    """A 7-digit or 9-digit suffix is NOT a date — don't strip it, that
    could corrupt a truly-custom model id."""
    assert normalize_model_id("claude-custom-1234567") == "claude-custom-1234567"
    assert normalize_model_id("claude-custom-123456789") == "claude-custom-123456789"


# ── find_model + pricing_for ────────────────────────────────────────

def test_find_model_resolves_dated_and_undated_to_same_entry():
    """The point of normalization — both forms must return the same
    ModelInfo, so the cost estimator can't ever under-count because
    the env has a dated id while the catalog has the undated form."""
    dated = find_model("claude-sonnet-4-6-20250415")
    undated = find_model("claude-sonnet-4-6")
    assert dated is not None
    assert dated is undated


def test_find_model_returns_none_for_unknown_family():
    assert find_model("claude-opus-5") is None
    assert find_model("gpt-4-turbo") is None


def test_pricing_for_sonnet_uses_sonnet_rates():
    inp, out = pricing_for("claude-sonnet-4-6-20250415")
    assert inp == 3.0
    assert out == 15.0


def test_pricing_for_haiku_uses_haiku_rates():
    inp, out = pricing_for("claude-haiku-4-5-20251001")
    assert inp == 1.0
    assert out == 5.0


def test_pricing_for_unknown_model_falls_back_to_sonnet_rates():
    """Fallback is a safe over-estimate — budget charges too much, not too
    little. Production would rather block a legitimate call than under-
    charge and blow the budget silently."""
    inp, out = pricing_for("claude-opus-5-20270101")
    assert inp == 3.0
    assert out == 15.0


def test_unknown_model_still_warns_through_llm_client(monkeypatch, capsys):
    """The new catalog path must not lose the one-time warning behavior
    that was valuable in the old _PRICING lookup."""
    monkeypatch.setattr(llm_client, "_unknown_model_warned", set())
    llm_client._estimate_cost("gpt-4-turbo", 1000, 1000)
    out = capsys.readouterr().out
    assert "gpt-4-turbo" in out
    assert "falling back" in out.lower()


# ── Catalog endpoint ────────────────────────────────────────────────

def test_catalog_endpoint_returns_both_default_models(client, admin_token):
    res = client.get("/api/v1/settings/models/catalog", headers=auth_header(admin_token))
    assert res.status_code == 200
    body = res.json()
    ids = {m["id"] for m in body["models"]}
    assert "claude-sonnet-4-6" in ids
    assert "claude-haiku-4-5" in ids


def test_catalog_endpoint_entries_have_pricing_and_recommendation(client, admin_token):
    """Every field the dropdown label needs must be present. If this test
    fails, the UI will render '[object Object]' or a blank row."""
    res = client.get("/api/v1/settings/models/catalog", headers=auth_header(admin_token))
    for m in res.json()["models"]:
        assert m["id"] and m["family"] and m["tier"] and m["label"]
        assert m["recommended_for"] in ("actor", "judge")
        assert m["pricing"]["input_per_million_usd"] > 0
        assert m["pricing"]["output_per_million_usd"] > 0


def test_catalog_endpoint_requires_auth(client):
    """Not sensitive, but shouldn't leak the model list to anonymous users."""
    res = client.get("/api/v1/settings/models/catalog")
    assert res.status_code == 401


def test_catalog_matches_pricing_used_by_estimator():
    """Belt-and-suspenders: the catalog rates and the cost-estimator rates
    must be identical — the whole point of the refactor was to avoid
    two sources of truth drifting apart."""
    for m in CATALOG:
        inp, out = pricing_for(m.id)
        assert inp == m.input_per_million_usd, f"{m.id} input rate drift"
        assert out == m.output_per_million_usd, f"{m.id} output rate drift"
