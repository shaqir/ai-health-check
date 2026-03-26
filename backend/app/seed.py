"""
Seed script — creates default users and sample services.
Run with: python -m app.seed
"""

from app.database import engine, SessionLocal, Base
from app.models import User, UserRole, AIService, Environment, SensitivityLabel
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
            model_name="claude-3-haiku-20240307",
            sensitivity_label=SensitivityLabel.internal,
            endpoint_url="https://api.anthropic.com/v1/messages",
        ),
        AIService(
            name="Internal Report Generator",
            owner="Analytics Team",
            environment=Environment.prod,
            model_name="claude-3-haiku-20240307",
            sensitivity_label=SensitivityLabel.confidential,
            endpoint_url="https://api.anthropic.com/v1/messages",
        ),
        AIService(
            name="Dev Chatbot (Staging)",
            owner="Engineering",
            environment=Environment.dev,
            model_name="claude-3-haiku-20240307",
            sensitivity_label=SensitivityLabel.public,
            endpoint_url="https://api.anthropic.com/v1/messages",
        ),
    ]
    db.add_all(services)
    db.commit()
    print("[Seed] Created 3 sample AI services")

    db.close()
    print("[Seed] Done!")


if __name__ == "__main__":
    seed()
