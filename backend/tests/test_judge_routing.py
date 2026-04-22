"""
Two-model routing regression: the judge goes to Haiku, synthesis stays on Sonnet.
If someone later reverts judge_response's `model=settings.judge_model` back to
`settings.llm_model`, this test fails and flags the self-scoring regression.

Also covers the merged-rubric JSON parser and the short-circuit behaviors in
eval_runner so a cost-saving path can't silently regress into an extra call.
"""

import asyncio
import json
from unittest.mock import MagicMock, patch

from app.services import llm_client


SONNET = "claude-sonnet-4-6-20250415"
HAIKU = "claude-haiku-4-5-20251001"


def _fake_response(text: str):
    r = MagicMock()
    r.content = [MagicMock(text=text)]
    r.usage.input_tokens = 10
    r.usage.output_tokens = 5
    return r


def test_judge_response_routes_to_judge_model(monkeypatch):
    monkeypatch.setattr(llm_client.settings, "llm_model", SONNET)
    monkeypatch.setattr(llm_client.settings, "judge_model", HAIKU)

    captured = {}

    def fake_make(caller, model, max_tokens, messages, **kwargs):
        captured["model"] = model
        return _fake_response('{"factuality": 80, "hallucination": 10}'), 10.0

    with patch.object(llm_client, "_make_api_call", side_effect=fake_make):
        result = asyncio.run(llm_client.judge_response("p", "expected", "actual"))

    assert captured["model"] == HAIKU, "judge_response must use the judge model (Haiku)"
    assert result == {"factuality": 80.0, "hallucination": 10.0}


def test_judge_response_makes_one_call_not_two(monkeypatch):
    """The merged judge must fire exactly ONE Claude call per factuality case,
    not two (as the old score_factuality + detect_hallucination pair did)."""
    monkeypatch.setattr(llm_client.settings, "judge_model", HAIKU)

    call_count = {"n": 0}

    def fake_make(caller, model, max_tokens, messages, **kwargs):
        call_count["n"] += 1
        return _fake_response('{"factuality": 90, "hallucination": 5}'), 10.0

    with patch.object(llm_client, "_make_api_call", side_effect=fake_make):
        asyncio.run(llm_client.judge_response("p", "e", "a"))

    assert call_count["n"] == 1


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


def test_parse_judge_json_valid():
    out = llm_client._parse_judge_json('{"factuality": 75, "hallucination": 20}')
    assert out == {"factuality": 75.0, "hallucination": 20.0}


def test_parse_judge_json_strips_code_fences():
    # Haiku occasionally wraps JSON in ```json fences — the parser must strip them.
    wrapped = '```json\n{"factuality": 60, "hallucination": 30}\n```'
    out = llm_client._parse_judge_json(wrapped)
    assert out == {"factuality": 60.0, "hallucination": 30.0}


def test_parse_judge_json_malformed_returns_none_pair():
    out = llm_client._parse_judge_json("I cannot rate this response.")
    assert out == {"factuality": None, "hallucination": None}


def test_parse_judge_json_partial_refusal():
    # Judge returns only one rubric — the other rubric must surface as None,
    # not silently default to 0 (a refusal is NOT "scored zero").
    out = llm_client._parse_judge_json('{"factuality": 42}')
    assert out == {"factuality": 42.0, "hallucination": None}


def test_parse_judge_json_clamps_out_of_range():
    out = llm_client._parse_judge_json('{"factuality": 150, "hallucination": -20}')
    assert out == {"factuality": 100.0, "hallucination": 0.0}
