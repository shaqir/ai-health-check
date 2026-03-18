"""
Role-Based Access Control (RBAC) middleware.
Usage: @router.post("/...", dependencies=[Depends(require_role(["admin", "maintainer"]))])
"""

from fastapi import Depends, HTTPException, status
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
    """

    async def role_checker(current_user: User = Depends(get_current_user)):
        if current_user.role.value not in allowed_roles:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Role '{current_user.role.value}' is not authorized. "
                       f"Required: {allowed_roles}",
            )
        return current_user

    return role_checker
