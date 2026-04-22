"""
AI Health Check — FastAPI Application Entry Point

Start with: uvicorn app.main:app --reload --port 8000
API docs:   http://localhost:8000/docs
"""

import time
from contextlib import asynccontextmanager

import httpx
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.middleware.correlation import CorrelationIdMiddleware
from apscheduler.schedulers.background import BackgroundScheduler
from sqlalchemy import text

from fastapi.responses import JSONResponse

from app.config import get_settings
from app.database import engine, Base, SessionLocal
from app.services.llm_client import BudgetExceededError
from app.services.safety import PromptSafetyError
from app.services.url_validator import UnsafeUrlError, validate_outbound_url

# Import all models so SQLAlchemy knows about them
from app.models import (  # noqa: F401
    User, AIService, ConnectionLog, EvalTestCase, EvalRun, EvalResult,
    Incident, MaintenancePlan, AuditLog, Telemetry, APIUsageLog, LoginAttempt, Alert,
    AILlmDraft,
)

# Import routers
from app.routers import auth, services, incidents, maintenance, evaluations, dashboard, settings as settings_router
from app.routers import users as compliance_users, audit as compliance_audit, export as compliance_export

settings = get_settings()

# Documented placeholder values that must NEVER be accepted in production.
# The config.py default and the .env.example placeholder both land here —
# a forgotten .env produces a signing key the whole internet can read.
_DEFAULT_SECRET_KEYS = frozenset({
    "change-me-in-production",
    "change-this-to-a-random-string-at-least-32-chars",
})


def _validate_secret_key(key: str) -> None:
    """
    Refuse boot if SECRET_KEY is unset, still a documented default, or too
    short to be meaningfully random. 32 bytes of urlsafe randomness
    (`secrets.token_urlsafe(32)` → 43 chars) is the minimum.

    Extracted as a plain function so it's unit-testable without spinning
    up the full lifespan.
    """
    if not key or key in _DEFAULT_SECRET_KEYS or len(key) < 32:
        raise RuntimeError(
            "SECRET_KEY is unset, still a documented default, or shorter "
            "than 32 chars. Generate a real one with "
            "`python -c 'import secrets; print(secrets.token_urlsafe(32))'` "
            "and set SECRET_KEY in backend/.env before starting the server."
        )


# Background scheduler for health checks / eval runs
scheduler = BackgroundScheduler()


def scheduled_eval_run():
    """Run evaluations against every active, non-confidential service that
    has at least one test case. Called every EVAL_SCHEDULE_MINUTES by
    APScheduler. Bridges sync scheduler thread -> async eval runner via
    asyncio.run() so the Claude client keeps its native async interface.
    """
    import asyncio
    from app.services.eval_runner import run_service_evaluation
    from app.models import SensitivityLabel

    db = SessionLocal()
    try:
        # Active services with test cases. Skip confidential — no admin on
        # this code path to approve the override, so we don't send their
        # prompts to an LLM automatically.
        service_ids = [
            row[0] for row in (
                db.query(AIService.id)
                .join(EvalTestCase, EvalTestCase.service_id == AIService.id)
                .filter(
                    AIService.is_active == True,
                    AIService.sensitivity_label != SensitivityLabel.confidential,
                )
                .distinct()
                .all()
            )
        ]

        for sid in service_ids:
            service = db.query(AIService).filter(AIService.id == sid).first()
            if not service:
                continue
            try:
                asyncio.run(run_service_evaluation(db, service, run_type="scheduled"))
                print(f"[EvalScheduler] Ran eval for service {sid} ({service.name})")
            except Exception as exc:
                print(f"[EvalScheduler] Failed for service {sid}: {exc}")
                db.rollback()
    except Exception as exc:
        print(f"[EvalScheduler] Error: {exc}")
        db.rollback()
    finally:
        db.close()


def scheduled_health_check():
    """Runs periodic health checks on all active services with an endpoint URL."""
    db = SessionLocal()
    try:
        active_services = db.query(AIService).filter(
            AIService.is_active == True,
            AIService.endpoint_url != "",
            AIService.endpoint_url != None,
        ).all()

        for service in active_services:
            start = time.perf_counter()
            # SSRF guard also on the scheduled path — stale data from before
            # the validator shipped, or a rebinding DNS record, shouldn't
            # be able to hit an internal address during the 5-minute tick.
            try:
                validate_outbound_url(service.endpoint_url)
            except UnsafeUrlError as exc:
                latency_ms = 0.0
                status_str = "failure"
                snippet = f"blocked: {exc}"
                db.add(ConnectionLog(
                    service_id=service.id,
                    latency_ms=latency_ms,
                    status=status_str,
                    response_snippet=snippet[:200],
                ))
                continue

            try:
                with httpx.Client(timeout=10.0, follow_redirects=True) as client:
                    response = client.get(service.endpoint_url)
                latency_ms = round((time.perf_counter() - start) * 1000, 1)
                # Liveness semantics: treat 4xx as reachable — many registered
                # AI endpoints are POST-only and return 405/401 to anonymous
                # GETs. Only 5xx + network errors count as the endpoint being
                # down. See routers/services._probe_service_endpoint.
                code = response.status_code
                if code < 500:
                    status_str = "success"
                else:
                    status_str = "failure"
                snippet = (response.text or "")[:200]
                if code >= 400:
                    snippet = f"HTTP {code} (reachable). {snippet[:150]}"
            except Exception as exc:
                latency_ms = round((time.perf_counter() - start) * 1000, 1)
                status_str = "failure"
                snippet = str(exc)[:200]

            log = ConnectionLog(
                service_id=service.id,
                latency_ms=latency_ms,
                status=status_str,
                response_snippet=snippet,
            )
            db.add(log)

            telemetry = Telemetry(
                service_id=service.id,
                metric_name="latency",
                metric_value=latency_ms,
            )
            db.add(telemetry)

        db.commit()
    except Exception as e:
        print(f"[HealthCheck] Error: {e}")
        db.rollback()
    finally:
        db.close()


def _install_audit_log_triggers():
    """
    Install SQLite triggers that block UPDATE and DELETE on audit_log.
    Defence-in-depth alongside the hash chain: application code literally
    cannot mutate past audit rows without a direct DB connection that
    disables the triggers. Production would use Postgres row permissions
    instead; this keeps the SQLite dev/test env honest.
    """
    if engine.dialect.name != "sqlite":
        return
    with engine.begin() as conn:
        conn.execute(text("""
            CREATE TRIGGER IF NOT EXISTS audit_log_no_update
            BEFORE UPDATE ON audit_log
            BEGIN
                SELECT RAISE(ABORT, 'audit_log is append-only: UPDATE blocked');
            END
        """))
        conn.execute(text("""
            CREATE TRIGGER IF NOT EXISTS audit_log_no_delete
            BEFORE DELETE ON audit_log
            BEGIN
                SELECT RAISE(ABORT, 'audit_log is append-only: DELETE blocked');
            END
        """))


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Startup and shutdown events."""
    # Fail fast on missing / default / weak SECRET_KEY. Running with a
    # documented placeholder means anyone who read .env.example can forge
    # a JWT — checked here so a bad deploy can't silently start.
    _validate_secret_key(settings.secret_key)

    # Create all tables (dev only — use Alembic migrations in production)
    Base.metadata.create_all(bind=engine)
    _install_audit_log_triggers()

    # Start background scheduler — can be disabled for demos via
    # SCHEDULER_ENABLED=false so metrics stay stable during narration.
    if settings.scheduler_enabled:
        scheduler.add_job(
            scheduled_health_check,
            "interval",
            minutes=settings.health_check_schedule_minutes,
            id="health_check",
        )
        scheduler.add_job(
            scheduled_eval_run,
            "interval",
            minutes=settings.eval_schedule_minutes,
            id="eval_run",
        )
        scheduler.start()
        print(f"[Startup] {settings.app_name} is running")
        print(f"[Startup] Background scheduler started "
              f"(health check every {settings.health_check_schedule_minutes}m, "
              f"eval every {settings.eval_schedule_minutes}m)")
    else:
        print(f"[Startup] {settings.app_name} is running")
        print("[Startup] Background scheduler DISABLED (SCHEDULER_ENABLED=false)")

    yield

    # Shutdown
    if settings.scheduler_enabled:
        scheduler.shutdown()
        print("[Shutdown] Scheduler stopped")


app = FastAPI(
    title=settings.app_name,
    description="AI Health Check — Health checks for your AI fleet. Monitor, evaluate, triage, and govern AI services.",
    version="0.1.0",
    lifespan=lifespan,
)

# CORS — allow frontend to call backend
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins.split(","),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    # Echo the correlation id in responses so the browser devtools network
    # tab can link a UI action to the trace row in Settings → Call Trace.
    expose_headers=["X-Correlation-Id"],
)

# Per-request correlation id (ASGI middleware, runs on every HTTP request).
# Must be added AFTER CORS so the CORS middleware wraps it — FastAPI
# applies middleware in reverse-add order, so the last-added runs first.
app.add_middleware(CorrelationIdMiddleware)

# ── Register Routers ──
app.include_router(auth.router, prefix="/api/v1/auth", tags=["Auth"])
app.include_router(services.router, prefix="/api/v1/services", tags=["Services"])
app.include_router(incidents.router, prefix="/api/v1/incidents", tags=["Incidents"])
app.include_router(maintenance.router, prefix="/api/v1/maintenance", tags=["Maintenance"])
app.include_router(evaluations.router, prefix="/api/v1/evaluations", tags=["Evaluations"])
app.include_router(dashboard.router, prefix="/api/v1/dashboard", tags=["Dashboard"])
app.include_router(settings_router.router, prefix="/api/v1/settings", tags=["Settings"])
# Compliance surface — split into three routers, all mounted under
# /api/v1/compliance so the frontend paths are unchanged.
app.include_router(compliance_users.router, prefix="/api/v1/compliance", tags=["Compliance · Users"])
app.include_router(compliance_audit.router, prefix="/api/v1/compliance", tags=["Compliance · Audit"])
app.include_router(compliance_export.router, prefix="/api/v1/compliance", tags=["Compliance · Export"])


# ── Global Exception Handlers ──

@app.exception_handler(BudgetExceededError)
async def budget_exceeded_handler(request, exc: BudgetExceededError):
    # HTTP status mapping by limit type:
    #   rate_limit / user_rate_limit  → 429 Too Many Requests
    #   daily / monthly               → 402 Payment Required (budget)
    #   prompt_chars                  → 413 Payload Too Large
    #   max_tokens / per_call_cost    → 422 Unprocessable Entity (bad request shape)
    limit_type = exc.limit_type
    if limit_type in ("rate_limit", "user_rate_limit"):
        status_code = 429
    elif limit_type in ("daily", "monthly"):
        status_code = 402
    elif limit_type == "prompt_chars":
        status_code = 413
    else:
        status_code = 422
    return JSONResponse(
        status_code=status_code,
        content={
            "detail": str(exc),
            "limit_type": limit_type,
            "exceeded_type": limit_type,  # kept for backward-compat clients
            "current": exc.current,
            "cap": exc.cap,
        },
    )


@app.exception_handler(PromptSafetyError)
async def prompt_safety_handler(request, exc: PromptSafetyError):
    return JSONResponse(
        status_code=422,
        content={
            "detail": str(exc),
            "safety_flags": exc.flags,
            "risk_score": exc.risk_score,
        },
    )


@app.get("/", tags=["Health"])
def root():
    return {"app": settings.app_name, "status": "running", "version": "0.1.0"}


@app.get("/api/v1/health", tags=["Health"])
def health_check():
    return {"status": "healthy"}
