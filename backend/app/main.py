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
from app.routers import auth, services, incidents, maintenance, evaluations, dashboard
from app.routers import users as compliance_users, audit as compliance_audit, export as compliance_export

settings = get_settings()

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
                status_str = "success" if response.is_success else "failure"
                snippet = (response.text or "")[:200]
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
)

# ── Register Routers ──
app.include_router(auth.router, prefix="/api/v1/auth", tags=["Auth"])
app.include_router(services.router, prefix="/api/v1/services", tags=["Services"])
app.include_router(incidents.router, prefix="/api/v1/incidents", tags=["Incidents"])
app.include_router(maintenance.router, prefix="/api/v1/maintenance", tags=["Maintenance"])
app.include_router(evaluations.router, prefix="/api/v1/evaluations", tags=["Evaluations"])
app.include_router(dashboard.router, prefix="/api/v1/dashboard", tags=["Dashboard"])
# Compliance surface — split into three routers, all mounted under
# /api/v1/compliance so the frontend paths are unchanged.
app.include_router(compliance_users.router, prefix="/api/v1/compliance", tags=["Compliance · Users"])
app.include_router(compliance_audit.router, prefix="/api/v1/compliance", tags=["Compliance · Audit"])
app.include_router(compliance_export.router, prefix="/api/v1/compliance", tags=["Compliance · Export"])


# ── Global Exception Handlers ──

@app.exception_handler(BudgetExceededError)
async def budget_exceeded_handler(request, exc: BudgetExceededError):
    status_code = 429 if exc.exceeded_type == "rate_limit" else 402
    return JSONResponse(
        status_code=status_code,
        content={"detail": str(exc), "exceeded_type": exc.exceeded_type},
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
