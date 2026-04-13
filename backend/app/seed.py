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
)
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
            endpoint_url="https://api.anthropic.com/v1/messages",
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
    eval_runs = []
    for svc in services:
        for i in range(5):
            days_ago = 6 - i
            quality = round(random.uniform(70, 98), 1)
            factuality = round(random.uniform(65, 100), 1)
            format_s = round(random.uniform(80, 100), 1)
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
    print(f"[Seed] Created {len(eval_runs)} historical eval runs")

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

    db.close()
    print("[Seed] Done!")


if __name__ == "__main__":
    seed()
