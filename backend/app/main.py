"""
AIHealthCheck — FastAPI Application Entry Point

Start with: uvicorn app.main:app --reload --port 8000
API docs:   http://localhost:8000/docs
"""

from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from apscheduler.schedulers.background import BackgroundScheduler

from app.config import get_settings
from app.database import engine, Base

# Import all models so SQLAlchemy knows about them
from app.models import (  # noqa: F401
    User, AIService, ConnectionLog, EvalTestCase, EvalRun,
    Incident, MaintenancePlan, AuditLog, Telemetry,
)

# Import routers
from app.routers import auth, services

settings = get_settings()

# Background scheduler for health checks / eval runs
scheduler = BackgroundScheduler()


def scheduled_health_check():
    """Placeholder — runs periodic health checks on registered services."""
    # TODO: Implement in Week 2 (Sakir + Jack)
    pass


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Startup and shutdown events."""
    # Create all tables (dev only — use Alembic migrations in production)
    Base.metadata.create_all(bind=engine)

    # Start background scheduler
    scheduler.add_job(
        scheduled_health_check,
        "interval",
        minutes=settings.health_check_schedule_minutes,
        id="health_check",
    )
    scheduler.start()
    print(f"[Startup] {settings.app_name} is running")
    print(f"[Startup] Background scheduler started")

    yield

    # Shutdown
    scheduler.shutdown()
    print("[Shutdown] Scheduler stopped")


app = FastAPI(
    title=settings.app_name,
    description="AIHealthCheck — Health checks for your AI fleet. Monitor, evaluate, triage, and govern AI services.",
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
# TODO: Add remaining routers as modules are built:
# app.include_router(evaluations.router, prefix="/api/v1/evaluations", tags=["Evaluations"])
# app.include_router(dashboard.router, prefix="/api/v1/dashboard", tags=["Dashboard"])
# app.include_router(incidents.router, prefix="/api/v1/incidents", tags=["Incidents"])
# app.include_router(maintenance.router, prefix="/api/v1/maintenance", tags=["Maintenance"])
# app.include_router(compliance.router, prefix="/api/v1/compliance", tags=["Compliance"])


@app.get("/", tags=["Health"])
def root():
    return {"app": settings.app_name, "status": "running", "version": "0.1.0"}


@app.get("/api/v1/health", tags=["Health"])
def health_check():
    return {"status": "healthy"}
