"""
AI Health Check — FastAPI Application Entry Point

Start with: uvicorn app.main:app --reload --port 8000
API docs:   http://localhost:8000/docs
"""

from contextlib import asynccontextmanager

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

# Background scheduler for periodic eval runs.
scheduler = BackgroundScheduler()


def scheduled_eval_run():
    """Run evaluations against every active, non-confidential service that
    has at least one test case. Called every EVAL_SCHEDULE_MINUTES by
    APScheduler. Bridges sync scheduler thread -> async eval runner via
    asyncio.run() so the Claude client keeps its native async interface.
    """
    import asyncio
    from app.services.eval_runner import run_service_evaluation

    db = SessionLocal()
    try:
        # Active services with test cases. Sensitivity labels are informational
        # only — the scheduler evaluates every active service regardless of
        # label, matching the demo configuration that allows LLM calls for all
        # services.
        service_ids = [
            row[0] for row in (
                db.query(AIService.id)
                .join(EvalTestCase, EvalTestCase.service_id == AIService.id)
                .filter(AIService.is_active == True)
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
    # Create all tables (dev only — use Alembic migrations in production)
    Base.metadata.create_all(bind=engine)
    _install_audit_log_triggers()

    # Start background scheduler — can be disabled for demos via
    # SCHEDULER_ENABLED=false so metrics stay stable during narration.
    if settings.scheduler_enabled:
        scheduler.add_job(
            scheduled_eval_run,
            "interval",
            minutes=settings.eval_schedule_minutes,
            id="eval_run",
        )
        scheduler.start()
        print(f"[Startup] {settings.app_name} is running")
        print(f"[Startup] Background scheduler started "
              f"(eval every {settings.eval_schedule_minutes}m)")
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
