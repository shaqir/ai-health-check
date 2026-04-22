"""
Multi-model pricing regression tests. Covers:
  - Sonnet rates applied when the model string matches Sonnet.
  - Haiku rates (cheaper) applied when the model string matches Haiku.
  - Unknown model falls back to Sonnet rates and warns exactly once.
"""

from app.services import llm_client


SONNET = "claude-sonnet-4-6-20250415"
HAIKU = "claude-haiku-4-5-20251001"


def test_sonnet_pricing_uses_sonnet_rates():
    cost = llm_client._estimate_cost(SONNET, 1_000_000, 1_000_000)
    # Sonnet: 3.0 input + 15.0 output = 18.0 per 1M+1M tokens
    assert round(cost, 4) == 18.0


def test_haiku_pricing_uses_haiku_rates():
    cost = llm_client._estimate_cost(HAIKU, 1_000_000, 1_000_000)
    # Haiku: 1.0 input + 5.0 output = 6.0 per 1M+1M tokens
    assert round(cost, 4) == 6.0


def test_haiku_is_cheaper_than_sonnet_at_same_token_count():
    sonnet = llm_client._estimate_cost(SONNET, 1000, 1000)
    haiku = llm_client._estimate_cost(HAIKU, 1000, 1000)
    # Haiku should be ~1/3 the cost
    assert haiku < sonnet
    assert round(sonnet / haiku, 2) == 3.0


def test_unknown_model_falls_back_to_sonnet_rates(monkeypatch, capsys):
    # Clear the warned set so the warning fires this run
    monkeypatch.setattr(llm_client, "_unknown_model_warned", set())
    cost = llm_client._estimate_cost("some-future-model-xyz", 1_000_000, 0)
    # Input-only cost at Sonnet rate: 3.0
    assert round(cost, 4) == 3.0
    out = capsys.readouterr().out
    assert "some-future-model-xyz" in out
    assert "falling back to Sonnet pricing" in out


def test_unknown_model_warns_only_once(monkeypatch, capsys):
    monkeypatch.setattr(llm_client, "_unknown_model_warned", set())
    llm_client._estimate_cost("same-unknown", 1, 1)
    first = capsys.readouterr().out
    llm_client._estimate_cost("same-unknown", 1, 1)
    second = capsys.readouterr().out
    assert "same-unknown" in first
    assert "same-unknown" not in second
