"""
SQLAlchemy ORM models — all database tables.
Every table includes id, created_at, updated_at.
"""

import enum
from datetime import datetime, timezone
from sqlalchemy import (
    Column, Integer, String, Float, Boolean, Text, DateTime,
    ForeignKey, Enum as SAEnum
)
from sqlalchemy.orm import relationship
from app.database import Base


# ── Enums ──

class UserRole(str, enum.Enum):
    admin = "admin"
    maintainer = "maintainer"
    viewer = "viewer"


class Environment(str, enum.Enum):
    dev = "dev"
    staging = "staging"
    prod = "prod"


class SensitivityLabel(str, enum.Enum):
    public = "public"
    internal = "internal"
    confidential = "confidential"


class Severity(str, enum.Enum):
    critical = "critical"
    high = "high"
    medium = "medium"
    low = "low"


class IncidentStatus(str, enum.Enum):
    open = "open"
    investigating = "investigating"
    resolved = "resolved"
    closed = "closed"


# ── Helper ──

def utcnow():
    return datetime.now(timezone.utc)


# ── Models ──

class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    username = Column(String(50), unique=True, nullable=False)
    email = Column(String(100), unique=True, nullable=False)
    password_hash = Column(String(255), nullable=False)
    role = Column(SAEnum(UserRole), default=UserRole.viewer, nullable=False)
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime, default=utcnow)
    updated_at = Column(DateTime, default=utcnow, onupdate=utcnow)


class AIService(Base):
    __tablename__ = "ai_services"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(100), nullable=False)
    owner = Column(String(100), nullable=False)
    environment = Column(SAEnum(Environment), nullable=False)
    model_name = Column(String(100), nullable=False)
    sensitivity_label = Column(
        SAEnum(SensitivityLabel), nullable=False
    )  # public / internal / confidential — exact values from project outline
    endpoint_url = Column(String(500), default="")
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime, default=utcnow)
    updated_at = Column(DateTime, default=utcnow, onupdate=utcnow)

    # Relationships
    connection_logs = relationship("ConnectionLog", back_populates="service")
    eval_test_cases = relationship("EvalTestCase", back_populates="service")
    eval_runs = relationship("EvalRun", back_populates="service")
    incidents = relationship("Incident", back_populates="service")
    telemetry = relationship("Telemetry", back_populates="service")


class ConnectionLog(Base):
    __tablename__ = "connection_logs"

    id = Column(Integer, primary_key=True, index=True)
    service_id = Column(Integer, ForeignKey("ai_services.id"), nullable=False)
    latency_ms = Column(Float, nullable=True)
    status = Column(String(20), nullable=False)  # "success" or "failure"
    response_snippet = Column(Text, default="")
    tested_at = Column(DateTime, default=utcnow)

    service = relationship("AIService", back_populates="connection_logs")


class EvalTestCase(Base):
    __tablename__ = "eval_test_cases"

    id = Column(Integer, primary_key=True, index=True)
    service_id = Column(Integer, ForeignKey("ai_services.id"), nullable=False)
    prompt = Column(Text, nullable=False)
    expected_output = Column(Text, nullable=False)
    category = Column(String(50), nullable=False)  # "factuality" or "format_json"
    created_at = Column(DateTime, default=utcnow)

    service = relationship("AIService", back_populates="eval_test_cases")


class EvalRun(Base):
    __tablename__ = "eval_runs"

    id = Column(Integer, primary_key=True, index=True)
    service_id = Column(Integer, ForeignKey("ai_services.id"), nullable=False)
    quality_score = Column(Float, nullable=False)
    factuality_score = Column(Float, nullable=True)
    format_score = Column(Float, nullable=True)
    hallucination_score = Column(Float, nullable=True)
    drift_flagged = Column(Boolean, default=False)
    run_type = Column(String(20), default="manual")  # "manual" or "scheduled"
    run_at = Column(DateTime, default=utcnow)
    created_at = Column(DateTime, default=utcnow)

    service = relationship("AIService", back_populates="eval_runs")
    results = relationship("EvalResult", back_populates="eval_run")


class EvalResult(Base):
    __tablename__ = "eval_results"

    id = Column(Integer, primary_key=True, index=True)
    eval_run_id = Column(Integer, ForeignKey("eval_runs.id"), nullable=False)
    test_case_id = Column(Integer, ForeignKey("eval_test_cases.id"), nullable=False)
    response_text = Column(Text, default="")
    score = Column(Float, nullable=False)
    latency_ms = Column(Float, default=0.0)
    status = Column(String(20), default="success")  # "success" or "error"
    created_at = Column(DateTime, default=utcnow)

    eval_run = relationship("EvalRun", back_populates="results")
    test_case = relationship("EvalTestCase")


class Incident(Base):
    __tablename__ = "incidents"

    id = Column(Integer, primary_key=True, index=True)
    service_id = Column(Integer, ForeignKey("ai_services.id"), nullable=False)
    severity = Column(SAEnum(Severity), nullable=False)
    symptoms = Column(Text, nullable=False)
    status = Column(SAEnum(IncidentStatus), default=IncidentStatus.open)
    timeline = Column(DateTime, nullable=True)
    # LLM-generated fields (require human approval)
    summary = Column(Text, default="")
    root_causes = Column(Text, default="")
    summary_draft = Column(Text, default="")  # Pending approval
    approved_by = Column(Integer, ForeignKey("users.id"), nullable=True)
    # Troubleshooting checklist
    checklist_data_issue = Column(Boolean, default=False)
    checklist_prompt_change = Column(Boolean, default=False)
    checklist_model_update = Column(Boolean, default=False)
    checklist_infrastructure = Column(Boolean, default=False)
    checklist_safety_policy = Column(Boolean, default=False)
    created_at = Column(DateTime, default=utcnow)
    updated_at = Column(DateTime, default=utcnow, onupdate=utcnow)

    service = relationship("AIService", back_populates="incidents")
    maintenance_plans = relationship("MaintenancePlan", back_populates="incident")


class MaintenancePlan(Base):
    __tablename__ = "maintenance_plans"

    id = Column(Integer, primary_key=True, index=True)
    incident_id = Column(Integer, ForeignKey("incidents.id"), nullable=False)
    risk_level = Column(SAEnum(Severity), nullable=False)
    rollback_plan = Column(Text, nullable=False)
    validation_steps = Column(Text, nullable=False)
    approved = Column(Boolean, default=False)
    scheduled_date = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=utcnow)
    updated_at = Column(DateTime, default=utcnow, onupdate=utcnow)

    incident = relationship("Incident", back_populates="maintenance_plans")


class AuditLog(Base):
    __tablename__ = "audit_log"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    action = Column(String(100), nullable=False)
    target_table = Column(String(50), nullable=False)
    target_id = Column(Integer, nullable=True)
    old_value = Column(Text, default="")
    new_value = Column(Text, default="")
    timestamp = Column(DateTime, default=utcnow)
    # Tamper-evidence hash chain. Each row commits to its content + the
    # previous row's hash, so any UPDATE/DELETE is detectable by replaying
    # the chain. DB triggers also block direct mutation (see main.py).
    content_hash = Column(String(64), default="")
    prev_hash = Column(String(64), default="")


class Telemetry(Base):
    __tablename__ = "telemetry"

    id = Column(Integer, primary_key=True, index=True)
    service_id = Column(Integer, ForeignKey("ai_services.id"), nullable=False)
    metric_name = Column(String(50), nullable=False)  # "latency", "error_rate", "quality_score"
    metric_value = Column(Float, nullable=False)
    recorded_at = Column(DateTime, default=utcnow)

    service = relationship("AIService", back_populates="telemetry")


class APIUsageLog(Base):
    __tablename__ = "api_usage_log"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    caller = Column(String(100), nullable=False)        # function name (e.g. "generate_summary")
    model = Column(String(100), nullable=False)          # model used
    input_tokens = Column(Integer, default=0)
    output_tokens = Column(Integer, default=0)
    total_tokens = Column(Integer, default=0)
    estimated_cost_usd = Column(Float, default=0.0)      # estimated cost in USD
    latency_ms = Column(Float, default=0.0)
    service_id = Column(Integer, ForeignKey("ai_services.id"), nullable=True)
    status = Column(String(30), default="success")       # "success", "error_timeout", "error_rate_limit", etc.
    safety_flags = Column(Text, default="")              # comma-separated safety flags
    risk_score = Column(Integer, default=0)               # 0-100 input risk score
    prompt_text = Column(Text, default="")               # actual prompt sent (truncated to 2000 chars)
    response_text = Column(Text, default="")             # actual response received (truncated to 2000 chars)
    timestamp = Column(DateTime, default=utcnow)


class LoginAttempt(Base):
    __tablename__ = "login_attempts"

    id = Column(Integer, primary_key=True, index=True)
    email = Column(String(100), nullable=False)
    success = Column(Boolean, default=False)
    ip_address = Column(String(45), default="")          # supports IPv6
    timestamp = Column(DateTime, default=utcnow)


class Alert(Base):
    __tablename__ = "alerts"

    id = Column(Integer, primary_key=True, index=True)
    alert_type = Column(String(50), nullable=False)      # "drift", "budget", "safety", "outage"
    severity = Column(String(20), nullable=False)         # "critical", "warning", "info"
    message = Column(Text, nullable=False)
    service_id = Column(Integer, ForeignKey("ai_services.id"), nullable=True)
    acknowledged = Column(Boolean, default=False)
    acknowledged_by = Column(Integer, ForeignKey("users.id"), nullable=True)
    acknowledged_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=utcnow)


class AILlmDraft(Base):
    """
    Human-in-the-loop envelope for LLM-generated content that needs human
    approval before it counts as official. Backs dashboard AI summaries and
    compliance AI reports. Incident summaries use a separate field pattern
    on the Incident model (kept as-is to avoid breaking its UI).
    """
    __tablename__ = "ai_llm_drafts"

    id = Column(Integer, primary_key=True, index=True)
    # Which surface generated this draft — keeps a single table for many uses.
    surface = Column(String(50), nullable=False)  # "dashboard_insight" | "compliance_report"
    surface_ref = Column(String(100), default="")  # optional external reference (date range, etc.)
    content = Column(Text, nullable=False)
    generated_by_user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    approved_by_user_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    approved_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=utcnow)
