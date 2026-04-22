"""
Correlation-id regression:

  - A request sets a fresh UUID; two "Claude calls" during that request
    read the SAME UUID via the ContextVar.
  - Outside any request context, get_correlation_id() returns None.
  - The response header X-Correlation-Id is echoed back to the client.
"""

import asyncio
import uuid

from app.middleware.correlation import (
    CorrelationIdMiddleware,
    get_correlation_id,
    _CORRELATION_ID,
)


def test_no_request_returns_none():
    """Background tasks + standalone scripts get None — their usage log
    rows intentionally have correlation_id NULL."""
    assert get_correlation_id() is None


def test_two_calls_inside_same_request_share_correlation_id():
    """Simulate the ASGI scope/receive/send dance and capture the value
    get_correlation_id() returns at two points inside the 'request'."""
    captured = []

    async def fake_app(scope, receive, send):
        captured.append(get_correlation_id())  # first "Claude call" sees the id
        captured.append(get_correlation_id())  # second "Claude call" sees the SAME id
        await send({"type": "http.response.start", "status": 200, "headers": []})
        await send({"type": "http.response.body", "body": b""})

    mw = CorrelationIdMiddleware(fake_app)

    sent = []
    async def send(msg): sent.append(msg)
    async def receive(): return {"type": "http.request", "body": b""}

    asyncio.run(mw({"type": "http", "headers": []}, receive, send))

    assert len(captured) == 2
    assert captured[0] is not None
    # Must be a valid UUID string
    uuid.UUID(captured[0])
    assert captured[0] == captured[1], "both calls inside one request must share the correlation_id"


def test_different_requests_get_different_ids():
    """Each request starts a new ContextVar scope — ids must not leak
    across requests (critical for concurrent-user isolation)."""
    seen = []

    async def fake_app(scope, receive, send):
        seen.append(get_correlation_id())
        await send({"type": "http.response.start", "status": 200, "headers": []})
        await send({"type": "http.response.body", "body": b""})

    mw = CorrelationIdMiddleware(fake_app)
    async def send(msg): pass
    async def receive(): return {"type": "http.request", "body": b""}

    asyncio.run(mw({"type": "http", "headers": []}, receive, send))
    asyncio.run(mw({"type": "http", "headers": []}, receive, send))

    assert seen[0] != seen[1], "two separate requests must get distinct correlation_ids"
    # And neither leaks to the post-request context:
    assert get_correlation_id() is None


def test_response_header_is_echoed_back():
    """Client sees X-Correlation-Id in the response, enabling devtools
    Network tab -> Settings trace row linking."""
    app_seen_cid = []
    response_headers = []

    async def fake_app(scope, receive, send):
        app_seen_cid.append(get_correlation_id())
        await send({"type": "http.response.start", "status": 200, "headers": []})
        await send({"type": "http.response.body", "body": b""})

    mw = CorrelationIdMiddleware(fake_app)

    async def send(msg):
        if msg["type"] == "http.response.start":
            response_headers.extend(msg["headers"])
    async def receive(): return {"type": "http.request", "body": b""}

    asyncio.run(mw({"type": "http", "headers": []}, receive, send))

    # Find the X-Correlation-Id header in what was sent back
    echoed = None
    for name, value in response_headers:
        if name == b"x-correlation-id":
            echoed = value.decode("ascii")
            break

    assert echoed is not None, "X-Correlation-Id header must be added to responses"
    assert echoed == app_seen_cid[0], "echoed header must match what the app saw internally"


def test_inbound_header_is_respected():
    """A client that sent X-Correlation-Id: ... (browser debugging, test
    harness, curl) gets THAT id preserved — lets callers pre-stamp a
    trace across the system boundary."""
    inbound_cid = "11111111-2222-3333-4444-555555555555"
    captured = []

    async def fake_app(scope, receive, send):
        captured.append(get_correlation_id())
        await send({"type": "http.response.start", "status": 200, "headers": []})
        await send({"type": "http.response.body", "body": b""})

    mw = CorrelationIdMiddleware(fake_app)
    async def send(msg): pass
    async def receive(): return {"type": "http.request", "body": b""}

    scope = {"type": "http", "headers": [(b"x-correlation-id", inbound_cid.encode())]}
    asyncio.run(mw(scope, receive, send))

    assert captured[0] == inbound_cid
