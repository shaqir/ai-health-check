"""
Pure-function tests for `classify_probe_response`.

The router's `_probe_service_endpoint` and the scheduler's
`scheduled_health_check` both need the same 4xx-reachable / 5xx-down
semantics. Before this extraction the classification logic was
duplicated in two files and drifted (the scheduler had a terser 4xx
snippet). Centralising it in one pure function guards against future
drift and makes the classification unit-testable without standing up
a TestClient.

Contract:
    classify_probe_response(code: int, snippet: str) -> tuple[str, str]
      returns (status, response_snippet)
      - status ∈ {"success", "failure"}
      - 2xx/3xx               -> ("success", body or "HTTP <code> from service endpoint")
      - 4xx (reachable but rejected)
                              -> ("success", "HTTP <code> (reachable — ...)")
      - 5xx                   -> ("failure", "HTTP <code> (server error). ...")
"""

import pytest

from app.routers.services import classify_probe_response


def test_classify_http_200_with_body_returns_body_as_snippet():
    status, snippet = classify_probe_response(200, "OK")
    assert status == "success"
    assert snippet == "OK"


def test_classify_http_204_no_body_uses_placeholder():
    status, snippet = classify_probe_response(204, "")
    assert status == "success"
    # Empty body should not produce an empty snippet — the dashboard
    # should at least see what code we got back.
    assert "204" in snippet


def test_classify_http_401_is_reachable_not_failure():
    """Anonymous GET to an auth-required endpoint is success on the
    liveness axis — the server answered us."""
    status, snippet = classify_probe_response(
        401, "Unauthorized"
    )
    assert status == "success"
    assert "reachable" in snippet.lower()
    assert "401" in snippet


def test_classify_http_405_post_only_endpoint_is_reachable():
    """Most registered AI endpoints (Anthropic, OpenAI) are POST-only
    and return 405 to GET. That's the server being up, not down."""
    status, snippet = classify_probe_response(
        405, "Method Not Allowed"
    )
    assert status == "success"
    assert "reachable" in snippet.lower()
    assert "405" in snippet


def test_classify_http_500_server_error_is_failure():
    status, snippet = classify_probe_response(
        500, "Internal Server Error"
    )
    assert status == "failure"
    assert "500" in snippet
    assert "server error" in snippet.lower()


def test_classify_http_503_truncates_long_body():
    """Guard against a 5xx service returning a huge error page
    overflowing the ConnectionLog.response_snippet 200-char column —
    the snippet we carry forward should be length-bounded."""
    long_body = "x" * 5000
    status, snippet = classify_probe_response(503, long_body)
    assert status == "failure"
    assert "503" in snippet
    # Helper's job is to bound the snippet; the DB column cap (200) is
    # a belt-and-braces downstream guard.
    assert len(snippet) < 300
