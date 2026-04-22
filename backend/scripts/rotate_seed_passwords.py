"""
Rotate seed user passwords from SEED_*_PASSWORD env vars WITHOUT
dropping the rest of the database.

Why it exists
-------------
`backend/app/seed.py` used to hardcode the demo passwords (one literal
per role) and those values were published in six places across the repo.
Commit `df4f9d0` moved the passwords to env-var overrides
(SEED_ADMIN_PASSWORD / SEED_MAINTAINER_PASSWORD / SEED_VIEWER_PASSWORD)
with demo fallbacks. But `seed.py` only runs on an EMPTY database —
existing users keep their old hashes forever until someone either
(a) drops `aiops.db` and reseeds (loses ALL other data), or (b) runs
this one-shot.

This script is option (b): targeted rotation that keeps everything
else in the DB intact.

Usage
-----
    # 1. Set the SEED_*_PASSWORD values you want in backend/.env
    # 2. Run from the backend directory:
    cd backend
    python -m scripts.rotate_seed_passwords

Behaviour
---------
For each known seed email:
  - If the corresponding env var is unset (or whitespace-only), SKIP.
  - If the user row doesn't exist in the DB, report as MISSING.
  - Otherwise: bcrypt-hash the new password, update the row, and
    append a `rotate_password` event to the tamper-evident audit log
    (with `user_id=None` — system action, not API-attributed).

Safe to re-run. Each rotation produces a new hash (bcrypt salt
differs) and a new audit row, but the login password is the same as
whatever the env var currently holds — so running twice just gives
you two audit rows for the same policy value.

See `backend/tests/test_rotate_seed_passwords.py` for coverage of
rotate / skip / missing / audit-trail / mixed paths.
"""

import os
import sys

from app.database import SessionLocal
from app.middleware.audit import log_action
from app.middleware.auth import hash_password
from app.models import User


# Canonical mapping of seed user emails to the env vars that control
# their passwords. Must stay in sync with `app/seed.py` — if a new
# seed user is added, update both files.
SEED_USER_ENV_VARS: dict[str, str] = {
    "admin@aiops.local":      "SEED_ADMIN_PASSWORD",
    "maintainer@aiops.local": "SEED_MAINTAINER_PASSWORD",
    "viewer@aiops.local":     "SEED_VIEWER_PASSWORD",
}


def rotate_seed_passwords() -> dict[str, list[str]]:
    """
    Iterate the seed email → env var mapping and rotate each user
    whose env var is set and whose row exists.

    Returns a dict with three lists so the CLI entry point and the
    tests can both consume the same result shape:
        {
          "rotated": [email, ...],     # bcrypt hash updated + audited
          "skipped": [email, ...],     # env var unset or whitespace
          "missing": [email, ...],     # env var set but user not in DB
        }
    """
    db = SessionLocal()
    try:
        rotated: list[str] = []
        skipped: list[str] = []
        missing: list[str] = []

        for email, env_var in SEED_USER_ENV_VARS.items():
            new_pwd = os.getenv(env_var, "").strip()
            if not new_pwd:
                skipped.append(email)
                continue

            user = db.query(User).filter(User.email == email).first()
            if user is None:
                missing.append(email)
                continue

            user.password_hash = hash_password(new_pwd)
            # Commit the password update first so the audit row's
            # prev_hash anchors AFTER the state change it's recording.
            db.commit()

            log_action(
                db,
                None,  # system action — no API user attributed
                "rotate_password",
                "users",
                user.id,
                new_value=f"rotated via {env_var}",
            )
            rotated.append(email)

        return {"rotated": rotated, "skipped": skipped, "missing": missing}
    finally:
        db.close()


def main() -> int:
    """CLI entry point. Formats the result for stdout."""
    result = rotate_seed_passwords()
    rotated = result["rotated"] or ["(none)"]
    print(f"[rotate] rotated: {', '.join(rotated)}")
    if result["skipped"]:
        print(
            f"[rotate] skipped (env var unset or whitespace): "
            f"{', '.join(result['skipped'])}"
        )
    if result["missing"]:
        print(
            f"[rotate] missing (user not in DB — run `python -m app.seed` "
            f"first): {', '.join(result['missing'])}"
        )
    return 0


if __name__ == "__main__":
    sys.exit(main())
