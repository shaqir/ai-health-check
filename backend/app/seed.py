"""
Seed script — creates default users, sample services, test cases, eval runs, and telemetry.
Run with: python -m app.seed
"""

import random
from datetime import datetime, timedelta, timezone

from app.database import engine, SessionLocal, Base
from app.models import (
    User, UserRole, AIService, Environment, SensitivityLabel,
    EvalTestCase, EvalRun, EvalResult, ConnectionLog, Telemetry,
    Alert,
)
from app.middleware.audit import log_action
from app.middleware.auth import hash_password


def seed():
    # Create all tables
    Base.metadata.create_all(bind=engine)

    db = SessionLocal()

    # Check if already seeded
    if db.query(User).first():
        print("[Seed] Database already has data — skipping")
        db.close()
        return

    now = datetime.now(timezone.utc)

    # ── Create default users (3 roles) ──
    users = [
        User(
            username="admin",
            email="admin@aiops.local",
            password_hash=hash_password("admin123"),
            role=UserRole.admin,
        ),
        User(
            username="maintainer",
            email="maintainer@aiops.local",
            password_hash=hash_password("maintain123"),
            role=UserRole.maintainer,
        ),
        User(
            username="viewer",
            email="viewer@aiops.local",
            password_hash=hash_password("viewer123"),
            role=UserRole.viewer,
        ),
    ]
    db.add_all(users)
    db.commit()
    print("[Seed] Created 3 default users (admin, maintainer, viewer)")

    # ── Create sample AI services ──
    services = [
        AIService(
            name="Customer Support Bot",
            owner="Support Team",
            environment=Environment.prod,
            model_name="claude-sonnet-4-6-20250415",
            sensitivity_label=SensitivityLabel.internal,
            endpoint_url="https://api.anthropic.com/v1/messages",
        ),
        AIService(
            name="Internal Report Generator",
            owner="Analytics Team",
            environment=Environment.prod,
            model_name="claude-sonnet-4-6-20250415",
            sensitivity_label=SensitivityLabel.confidential,
            endpoint_url="https://api.anthropic.com/v1/messages/batches",
        ),
        AIService(
            name="Dev Chatbot (Staging)",
            owner="Engineering",
            environment=Environment.dev,
            model_name="claude-sonnet-4-6-20250415",
            sensitivity_label=SensitivityLabel.public,
            endpoint_url="https://api.anthropic.com/v1/messages",
        ),
    ]
    db.add_all(services)
    db.commit()
    print("[Seed] Created 3 sample AI services")

    # ── Create eval test cases (2 per service) ──
    test_cases = []
    for svc in services:
        test_cases.append(EvalTestCase(
            service_id=svc.id,
            prompt="What is the capital of France?",
            expected_output="The capital of France is Paris.",
            category="factuality",
        ))
        test_cases.append(EvalTestCase(
            service_id=svc.id,
            prompt='Return a JSON object with keys "name" and "status" for a healthy service.',
            expected_output='{"name": "test", "status": "healthy"}',
            category="format_json",
        ))
    db.add_all(test_cases)
    db.commit()
    print(f"[Seed] Created {len(test_cases)} eval test cases")

    # ── Create historical eval runs (5 runs spread over 7 days) ──
    # Deliberately include a drift scenario on the second service so the
    # dashboard shows an Active Alerts banner on first login — no need
    # to run a live eval that depends on Claude's mood for the demo to
    # show something interesting.
    eval_runs = []
    for svc_idx, svc in enumerate(services):
        for i in range(5):
            days_ago = 6 - i
            # Service 2 (index 1): last run drops to 42% — a clean
            # critical-drift scenario visible on the Dashboard.
            is_drift_demo = (svc_idx == 1 and i == 4)
            if is_drift_demo:
                quality = 42.0
                factuality = 38.0
                format_s = 50.0
            else:
                quality = round(random.uniform(82, 98), 1)
                factuality = round(random.uniform(80, 100), 1)
                format_s = round(random.uniform(85, 100), 1)
            eval_runs.append(EvalRun(
                service_id=svc.id,
                quality_score=quality,
                factuality_score=factuality,
                format_score=format_s,
                drift_flagged=quality < 75.0,
                run_type="scheduled" if i % 2 == 0 else "manual",
                run_at=now - timedelta(days=days_ago, hours=random.randint(0, 12)),
            ))
    db.add_all(eval_runs)
    db.commit()
    print(f"[Seed] Created {len(eval_runs)} historical eval runs "
          f"(with 1 pre-flagged drift scenario)")

    # ── Create eval results (per-test-case scores for each run) ──
    eval_results = []
    for run in eval_runs:
        svc_test_cases = [tc for tc in test_cases if tc.service_id == run.service_id]
        for tc in svc_test_cases:
            score = round(random.uniform(60, 100), 1) if tc.category == "factuality" else (
                100.0 if random.random() > 0.3 else 0.0
            )
            eval_results.append(EvalResult(
                eval_run_id=run.id,
                test_case_id=tc.id,
                response_text="Seeded response",
                score=score,
                latency_ms=round(random.uniform(500, 3000), 1),
                status="success",
            ))
    db.add_all(eval_results)
    db.commit()
    print(f"[Seed] Created {len(eval_results)} eval result entries")

    # ── Create connection logs (20 entries over 7 days) ──
    conn_logs = []
    for svc in services:
        for i in range(7):
            days_ago = 6 - i
            for _ in range(random.randint(1, 3)):
                is_success = random.random() > 0.15
                latency = round(random.uniform(80, 350), 1)
                conn_logs.append(ConnectionLog(
                    service_id=svc.id,
                    latency_ms=latency,
                    status="success" if is_success else "failure",
                    response_snippet="OK" if is_success else "Connection timeout",
                    tested_at=now - timedelta(
                        days=days_ago,
                        hours=random.randint(0, 23),
                        minutes=random.randint(0, 59),
                    ),
                ))
    db.add_all(conn_logs)
    db.commit()
    print(f"[Seed] Created {len(conn_logs)} connection log entries")

    # ── Create telemetry entries ──
    telemetry = []
    for svc in services:
        for i in range(7):
            days_ago = 6 - i
            ts = now - timedelta(days=days_ago, hours=random.randint(0, 12))
            telemetry.append(Telemetry(
                service_id=svc.id,
                metric_name="latency",
                metric_value=round(random.uniform(100, 300), 1),
                recorded_at=ts,
            ))
            telemetry.append(Telemetry(
                service_id=svc.id,
                metric_name="quality_score",
                metric_value=round(random.uniform(70, 98), 1),
                recorded_at=ts,
            ))
    db.add_all(telemetry)
    db.commit()
    print(f"[Seed] Created {len(telemetry)} telemetry entries")

    # ── Alert for the pre-seeded drift scenario ──
    # Matches the drift_flagged=True run on service index 1. Examiners
    # see the Dashboard "Active Alerts" banner on first login without
    # having to run a live eval.
    drift_service = services[1]
    alert = Alert(
        alert_type="drift",
        severity="critical",
        message=(
            f"{drift_service.name} quality dropped to 42.0% "
            f"(threshold: 75.0%)"
        ),
        service_id=drift_service.id,
        acknowledged=False,
    )
    db.add(alert)
    db.commit()
    db.refresh(alert)
    # Audit the alert creation so the governance trail is complete for
    # the demo's end-to-end narrative.
    log_action(
        db, None, "alert_created", "alerts",
        alert.id, new_value=f"drift|critical|service={drift_service.id}|score=42.0",
    )
    print(f"[Seed] Created 1 drift alert for '{drift_service.name}' (demo-ready)")

    db.close()
    print("[Seed] Done!")


if __name__ == "__main__":
    seed()
