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


# Hardcoded demo passwords for the three seeded roles. This is a capstone
# demo project — these credentials are intentionally known and shared.
SEED_ADMIN_PASSWORD = "admin123"
SEED_MAINTAINER_PASSWORD = "maintainer123"
SEED_VIEWER_PASSWORD = "viewer123"


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
            password_hash=hash_password(SEED_ADMIN_PASSWORD),
            role=UserRole.admin,
        ),
        User(
            username="maintainer",
            email="maintainer@aiops.local",
            password_hash=hash_password(SEED_MAINTAINER_PASSWORD),
            role=UserRole.maintainer,
        ),
        User(
            username="viewer",
            email="viewer@aiops.local",
            password_hash=hash_password(SEED_VIEWER_PASSWORD),
            role=UserRole.viewer,
        ),
    ]
    db.add_all(users)
    db.commit()
    print("[Seed] Created 3 default users (admin / maintainer / viewer)")

    # ── Create sample AI services ──
    services = [
        AIService(
            name="Customer Support Bot",
            owner="Support Team",
            environment=Environment.prod,
            # Canonical catalog id (undated). A dated snapshot like
            # claude-sonnet-4-6-20250415 is fragile — Anthropic has
            # retired some snapshots and returns 404, which shows up on
            # the Services page as a Ping failure. The undated form
            # always resolves to the latest release within the family.
            model_name="claude-sonnet-4-6",
            sensitivity_label=SensitivityLabel.internal,
        ),
        AIService(
            name="Internal Report Generator",
            owner="Analytics Team",
            environment=Environment.prod,
            model_name="claude-sonnet-4-6",
            sensitivity_label=SensitivityLabel.confidential,
        ),
        AIService(
            name="Dev Chatbot (Staging)",
            owner="Engineering",
            environment=Environment.dev,
            model_name="claude-sonnet-4-6",
            sensitivity_label=SensitivityLabel.public,
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
    # Three clearly-different drift scenarios across the three seeded
    # services so the Dashboard shows the full signal vocabulary on
    # first login — no live eval needed:
    #   idx 0 (Customer Support Bot)       → healthy baseline
    #   idx 1 (Internal Report Generator)  → critical drift (threshold)
    #   idx 2 (Dev Chatbot)                → warning drift (declining trend)
    #
    # Warning-sequence numbers chosen to mirror
    # drift_trend.compute_quality_trend's math exactly:
    #   first_half  = mean(90, 86)           = 88.0
    #   second_half = mean(82, 78, 76)       ≈ 78.67
    #   diff = -9.33 → trend="declining" (< -3.0 threshold)
    # And the eval_runner gate that promotes this to a warning alert:
    #   if trend == "declining" and quality < drift_threshold + 10:
    #       drift_flagged = True
    #   severity = "critical" if quality < drift_threshold else "warning"
    # With quality=76 and drift_threshold=75:
    #   76 < 85 → drift_flagged = True; 76 >= 75 → severity = "warning".
    _WARNING_TREND = [90.0, 86.0, 82.0, 78.0, 76.0]

    eval_runs = []
    for svc_idx, svc in enumerate(services):
        for i in range(5):
            days_ago = 6 - i
            if svc_idx == 1 and i == 4:
                # Critical: quality well below threshold.
                quality, factuality, format_s = 42.0, 38.0, 50.0
                drift_flagged = True
            elif svc_idx == 2:
                # Warning: five-run declining sequence. Only the most-
                # recent run is flagged — drift detection fires on the
                # current run, not retroactively on history.
                quality = _WARNING_TREND[i]
                factuality = round(quality - random.uniform(1.0, 4.0), 1)
                format_s = round(random.uniform(85, 98), 1)
                drift_flagged = (i == 4)
            else:
                # Healthy baseline (idx 0, plus idx 1 runs 0-3).
                quality = round(random.uniform(82, 98), 1)
                factuality = round(random.uniform(80, 100), 1)
                format_s = round(random.uniform(85, 100), 1)
                drift_flagged = False

            eval_runs.append(EvalRun(
                service_id=svc.id,
                quality_score=quality,
                factuality_score=factuality,
                format_score=format_s,
                drift_flagged=drift_flagged,
                run_type="scheduled" if i % 2 == 0 else "manual",
                run_at=now - timedelta(days=days_ago, hours=random.randint(0, 12)),
            ))
    db.add_all(eval_runs)
    db.commit()
    print(
        f"[Seed] Created {len(eval_runs)} historical eval runs "
        f"(1 critical drift on service #{services[1].id}, "
        f"1 warning trend on service #{services[2].id})"
    )

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

    # ── Alerts for the pre-seeded drift scenarios ──
    # One alert per non-healthy seeded service, so the Dashboard banner
    # communicates the full severity spectrum (warning + critical) on
    # first login — no live eval needed.
    critical_service = services[1]
    warning_service = services[2]
    alerts = [
        Alert(
            alert_type="drift",
            severity="critical",
            message=(
                f"{critical_service.name} quality dropped to 42.0% "
                f"(threshold: 75.0%)"
            ),
            service_id=critical_service.id,
            acknowledged=False,
        ),
        Alert(
            alert_type="drift",
            severity="warning",
            message=(
                f"{warning_service.name} quality trending down — last 5 runs: "
                f"90 → 86 → 82 → 78 → 76 (threshold: 75.0%)"
            ),
            service_id=warning_service.id,
            acknowledged=False,
        ),
    ]
    db.add_all(alerts)
    db.commit()
    # Audit each alert so the governance trail is complete for the
    # demo's end-to-end narrative.
    for alert in alerts:
        db.refresh(alert)
        log_action(
            db, None, "alert_created", "alerts", alert.id,
            new_value=f"drift|{alert.severity}|service={alert.service_id}",
        )
    print(
        f"[Seed] Created {len(alerts)} drift alerts "
        f"(critical on '{critical_service.name}', "
        f"warning on '{warning_service.name}')"
    )

    db.close()
    print("[Seed] Done!")


if __name__ == "__main__":
    seed()
