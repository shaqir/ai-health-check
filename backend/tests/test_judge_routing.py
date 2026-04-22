"""
Two-tier routing regression: judges go to Haiku, synthesis stays on Sonnet.
If someone later reverts a judge's `model=settings.judge_model` back to
`settings.llm_model`, this test fails and flags the Q15 circularity regression.
"""

import asyncio
from unittest.mock import MagicMock, patch

from app.services import llm_client


SONNET = "claude-sonnet-4-6-20250415"
HAIKU = "claude-haiku-4-5-20251001"


def _fake_response(text: str = "50"):
    r = MagicMock()
    r.content = [MagicMock(text=text)]
    r.usage.input_tokens = 10
    r.usage.output_tokens = 5
    return r


def test_score_factuality_routes_to_judge_model(monkeypatch):
    monkeypatch.setattr(llm_client.settings, "llm_model", SONNET)
    monkeypatch.setattr(llm_client.settings, "judge_model", HAIKU)

    captured = {}

    def fake_make(caller, model, max_tokens, messages, **kwargs):
        captured["model"] = model
        return _fake_response("75"), 10.0

    with patch.object(llm_client, "_make_api_call", side_effect=fake_make):
        asyncio.run(llm_client.score_factuality("expected", "actual"))

    assert captured["model"] == HAIKU, "score_factuality must use the judge model (Haiku)"


def test_detect_hallucination_routes_to_judge_model(monkeypatch):
    monkeypatch.setattr(llm_client.settings, "llm_model", SONNET)
    monkeypatch.setattr(llm_client.settings, "judge_model", HAIKU)

    captured = {}

    def fake_make(caller, model, max_tokens, messages, **kwargs):
        captured["model"] = model
        return _fake_response("20"), 10.0

    with patch.object(llm_client, "_make_api_call", side_effect=fake_make):
        asyncio.run(llm_client.detect_hallucination("prompt", "response"))

    assert captured["model"] == HAIKU, "detect_hallucination must use the judge model (Haiku)"


def test_generate_summary_stays_on_actor_model(monkeypatch):
    """Synthesis tasks (Sonnet) must NOT accidentally migrate to Haiku."""
    monkeypatch.setattr(llm_client.settings, "llm_model", SONNET)
    monkeypatch.setattr(llm_client.settings, "judge_model", HAIKU)

    captured = {}

    def fake_make(caller, model, max_tokens, messages, **kwargs):
        captured["model"] = model
        return _fake_response("STAKEHOLDER UPDATE: ok\nROOT CAUSES: 1. x\n2. y\n3. z"), 10.0

    with patch.object(llm_client, "_make_api_call", side_effect=fake_make):
        asyncio.run(llm_client.generate_summary("svc", "high", "down", {"restart": True}))

    assert captured["model"] == SONNET, "generate_summary must stay on the actor/Sonnet model"


def test_generate_compliance_summary_stays_on_actor_model(monkeypatch):
    monkeypatch.setattr(llm_client.settings, "llm_model", SONNET)
    monkeypatch.setattr(llm_client.settings, "judge_model", HAIKU)

    captured = {}

    def fake_make(caller, model, max_tokens, messages, **kwargs):
        captured["model"] = model
        return _fake_response("short report"), 10.0

    with patch.object(llm_client, "_make_api_call", side_effect=fake_make):
        asyncio.run(llm_client.generate_compliance_summary([], [], []))

    assert captured["model"] == SONNET
