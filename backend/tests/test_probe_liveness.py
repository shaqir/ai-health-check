"""
Ping probe liveness semantics — the Service Registry's "Ping" button should
treat 4xx as "reachable" (because most registered AI endpoints are POST-only
and return 405/401 to anonymous GETs). Only 5xx + network errors are real
failures.

Regression for the bug where every seeded Anthropic endpoint showed "Failed"
because /v1/messages returns 405 to unauthenticated GET.
"""

import asyncio
from unittest.mock import MagicMock, patch

import httpx

from app.routers import services as services_router


def _build_fake_client(status_code: int, body: str = "", raise_on_get: Exception | None = None):
    """Patch httpx.AsyncClient so our probe gets a canned response."""
    class _FakeClient:
        def __init__(self, *a, **kw):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *a, **kw):
            return False

        async def get(self, url):
            if raise_on_get:
                raise raise_on_get
            return httpx.Response(status_code, text=body, request=httpx.Request("GET", url))

    return _FakeClient


def _run_probe(url: str, fake_client_factory):
    with patch.object(httpx, "AsyncClient", fake_client_factory), \
         patch.object(services_router, "validate_outbound_url", lambda _: None):
        return asyncio.run(services_router._probe_service_endpoint(url))


def test_probe_405_treated_as_reachable():
    """Anthropic /v1/messages returns 405 to GET. Must be 'success' now."""
    fake = _build_fake_client(405, body='{"type":"error"}')
    result = _run_probe("https://api.anthropic.com/v1/messages", fake)
    assert result["status"] == "success"
    assert result["http_status"] == 405
    assert "reachable" in result["response_snippet"].lower()


def test_probe_401_treated_as_reachable():
    """Anthropic /v1/messages/batches returns 401 without auth. Must be 'success' now."""
    fake = _build_fake_client(401, body='{"type":"error","error":{"type":"authentication_error"}}')
    result = _run_probe("https://api.anthropic.com/v1/messages/batches", fake)
    assert result["status"] == "success"
    assert result["http_status"] == 401


def test_probe_200_is_success():
    fake = _build_fake_client(200, body="hello")
    result = _run_probe("https://example.com/health", fake)
    assert result["status"] == "success"
    assert result["http_status"] == 200


def test_probe_500_is_failure():
    """5xx = server error = actually unhealthy."""
    fake = _build_fake_client(500, body="internal server error")
    result = _run_probe("https://example.com/api", fake)
    assert result["status"] == "failure"
    assert result["http_status"] == 500


def test_probe_network_error_is_failure():
    fake = _build_fake_client(0, raise_on_get=httpx.ConnectError("refused"))
    result = _run_probe("https://unreachable.example.com", fake)
    assert result["status"] == "failure"
    assert "refused" in result["response_snippet"]
