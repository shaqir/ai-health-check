"""
Role-Based Access Control (RBAC) middleware.
Usage: @router.post("/...", dependencies=[Depends(require_role(["admin", "maintainer"]))])

Every 403 is recorded in the audit log so forensic review surfaces probing.
"""

from fastapi import Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.database import get_db
from app.middleware.auth import get_current_user
from app.models import User


def require_role(allowed_roles: list[str]):
    """
    Returns a FastAPI dependency that checks if the current user
    has one of the allowed roles. Viewer is blocked from mutations.

    Roles:
      - admin: full access (CRUD + user management + audit log + export)
      - maintainer: can manage services, incidents, evals (no user mgmt)
      - viewer: read-only access to dashboards and data

    Forensic note: every 403 writes a `role_denied` record to audit_log so
    probing attempts are surfaced during compliance review.
    """

    async def role_checker(
        current_user: User = Depends(get_current_user),
        db: Session = Depends(get_db),
    ):
        if current_user.role.value not in allowed_roles:
            # Import here to avoid circular import
            from app.middleware.audit import log_action

            try:
                log_action(
                    db,
                    current_user.id,
                    "role_denied",
                    "users",
                    current_user.id,
                    old_value=current_user.role.value,
                    new_value=f"required:{','.join(allowed_roles)}",
                )
            except Exception:
                # Audit failure must not mask the 403
                pass

            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Role '{current_user.role.value}' is not authorized. "
                       f"Required: {allowed_roles}",
            )
        return current_user

    return role_checker
