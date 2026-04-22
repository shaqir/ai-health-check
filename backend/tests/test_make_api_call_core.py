"""
Regression: `_make_api_call_core` must NOT run `scan_input`, and
`_make_api_call` must STILL run `scan_input`.

This split exists so `detect_injection` can invoke Claude without
re-entering `scan_input` (which would recurse forever: scan_input →
detect_injection → _make_api_call → scan_input → ...).
"""

import threading
from unittest.mock import MagicMock, patch

from app.services import llm_client


def _install_fake_anthropic(monkeypatch):
    fake_resp = MagicMock()
    fake_resp.content = [MagicMock(text="hi")]
    fake_resp.usage.input_tokens = 1
    fake_resp.usage.output_tokens = 1

    class _FakeClient:
        class messages:
            @staticmethod
            def create(**_):
                return fake_resp

    monkeypatch.setattr(llm_client, "_get_client", lambda: _FakeClient())


def test_core_does_not_call_scan_input(monkeypatch):
    _install_fake_anthropic(monkeypatch)
    monkeypatch.setattr(llm_client.settings, "api_daily_budget", 100.0)
    monkeypatch.setattr(llm_client.settings, "api_monthly_budget", 1000.0)
    monkeypatch.setattr(llm_client.settings, "api_max_calls_per_minute", 1000)
    monkeypatch.setattr(llm_client.settings, "api_max_calls_per_user_per_minute", 1000)

    scan_calls = {"count": 0}

    def tracking_scan(_):
        scan_calls["count"] += 1
        return {"safe": True, "flags": [], "risk_score": 0}

    # scan_output still needs to work (called inside core)
    with patch("app.services.safety.scan_input", side_effect=tracking_scan), \
         patch("app.services.safety.scan_output", return_value={"flags": []}):
        llm_client._make_api_call_core(
            caller="detect_injection",
            model="claude-haiku-4-5-20251001",
            max_tokens=50,
            messages=[{"role": "user", "content": "anything"}],
            max_retries=0,
        )

    assert scan_calls["count"] == 0, "_make_api_call_core must NOT invoke scan_input"


def test_wrapper_does_call_scan_input(monkeypatch):
    _install_fake_anthropic(monkeypatch)
    monkeypatch.setattr(llm_client.settings, "api_daily_budget", 100.0)
    monkeypatch.setattr(llm_client.settings, "api_monthly_budget", 1000.0)
    monkeypatch.setattr(llm_client.settings, "api_max_calls_per_minute", 1000)
    monkeypatch.setattr(llm_client.settings, "api_max_calls_per_user_per_minute", 1000)

    scan_calls = {"count": 0}

    def tracking_scan(_):
        scan_calls["count"] += 1
        return {"safe": True, "flags": [], "risk_score": 0}

    with patch("app.services.safety.scan_input", side_effect=tracking_scan), \
         patch("app.services.safety.scan_output", return_value={"flags": []}):
        llm_client._make_api_call(
            caller="test",
            model="claude-sonnet-4-6-20250415",
            max_tokens=50,
            messages=[{"role": "user", "content": "hello"}],
            max_retries=0,
        )

    assert scan_calls["count"] == 1, "_make_api_call wrapper must invoke scan_input exactly once"
