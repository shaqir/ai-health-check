"""
Per-request correlation IDs.

Every HTTP request gets a fresh UUID stored in a ContextVar. Every Claude
call fired inside that request reads the ContextVar and stamps the same
UUID onto the api_usage_log row. Downstream views can then group rows
by correlation_id to show "one user action → N Claude calls."

Why a contextvar (and not a kwarg threaded through every function):
  - There are 7+ public LLM functions, each called from 5+ routers, each
    fanning out to _reserve_slot / _log_usage / _finalize_reservation.
    Threading a correlation_id explicitly everywhere is ~20 signatures.
  - ContextVar is asyncio-safe and FastAPI-native: a value set per-request
    does not leak across concurrent requests.
  - Functions that don't care (tests, background jobs) get None.

Background tasks run outside any HTTP request, so get_correlation_id()
returns None for them — their api_usage_log rows have correlation_id=NULL.
That's intentional: a scheduled eval is not one user's action.
"""
import contextvars
import uuid

from starlette.types import ASGIApp, Message, Receive, Scope, Send


_CORRELATION_ID: contextvars.ContextVar[str | None] = contextvars.ContextVar(
    "correlation_id", default=None
)


def get_correlation_id() -> str | None:
    """Return the correlation_id for the current async context, or None
    if there isn't one (background task, test, script)."""
    return _CORRELATION_ID.get()


class CorrelationIdMiddleware:
    """
    ASGI middleware that assigns a fresh UUID to every HTTP request and
    echoes it back in the `X-Correlation-Id` response header so the
    frontend can link a user action to its trace row.
    """

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        # Respect an inbound header if the client sent one (allows
        # client-initiated traces, e.g. browser debugging). Otherwise
        # generate a fresh UUID4.
        incoming = None
        for name, value in scope.get("headers", []):
            if name == b"x-correlation-id":
                try:
                    incoming = value.decode("ascii")[:36]
                except UnicodeDecodeError:
                    incoming = None
                break
        cid = incoming or str(uuid.uuid4())
        token = _CORRELATION_ID.set(cid)

        async def send_with_header(message: Message) -> None:
            if message["type"] == "http.response.start":
                headers = list(message.get("headers", []))
                headers.append((b"x-correlation-id", cid.encode("ascii")))
                message["headers"] = headers
            await send(message)

        try:
            await self.app(scope, receive, send_with_header)
        finally:
            _CORRELATION_ID.reset(token)
