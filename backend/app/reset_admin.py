"""
Admin Password Reset CLI — Failsafe for locked-out admins.

Usage:
  python -m app.reset_admin                          # Reset default admin user
  python -m app.reset_admin --email admin@aiops.local  # Reset specific user
  python -m app.reset_admin --email admin@aiops.local --password newpass123

Requires direct server/terminal access — the most secure recovery path.
"""

import argparse
import getpass
from app.database import engine, SessionLocal, Base
from app.models import User, UserRole
from app.middleware.auth import hash_password


def reset_admin(email: str | None = None, new_password: str | None = None):
    """Reset an admin user's password, or recreate the default admin if missing."""
    Base.metadata.create_all(bind=engine)
    db = SessionLocal()

    try:
        # Find the target user
        if email:
            user = db.query(User).filter(User.email == email).first()
        else:
            # Default: find any admin user
            user = db.query(User).filter(User.role == UserRole.admin).first()

        if user:
            # Prompt for password if not provided
            if not new_password:
                new_password = getpass.getpass("Enter new password: ")
                confirm = getpass.getpass("Confirm new password: ")
                if new_password != confirm:
                    print("[Error] Passwords do not match.")
                    return False

            user.password_hash = hash_password(new_password)
            user.is_active = True  # Re-activate in case account was disabled
            db.commit()
            print(f"[OK] Password reset for '{user.username}' ({user.email})")
            print(f"[OK] Role: {user.role.value} | Active: True")
            return True
        else:
            # No admin exists — create the default admin
            print("[Warning] No admin user found. Creating default admin...")
            if not new_password:
                new_password = getpass.getpass("Set password for new admin: ")
                confirm = getpass.getpass("Confirm password: ")
                if new_password != confirm:
                    print("[Error] Passwords do not match.")
                    return False

            new_admin = User(
                username="admin",
                email="admin@aiops.local",
                password_hash=hash_password(new_password),
                role=UserRole.admin,
                is_active=True,
            )
            db.add(new_admin)
            db.commit()
            print(f"[OK] Created new admin user: admin@aiops.local")
            return True
    finally:
        db.close()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Reset admin password (failsafe)")
    parser.add_argument("--email", type=str, default=None, help="Email of user to reset")
    parser.add_argument("--password", type=str, default=None, help="New password (prompted if omitted)")
    args = parser.parse_args()

    print("=" * 50)
    print("  AIHealthCheck — Admin Password Reset")
    print("=" * 50)
    reset_admin(email=args.email, new_password=args.password)
