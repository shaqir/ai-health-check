"""
User management router (Module 4).
Admin-only endpoints for listing users and updating their role.
"""

from datetime import timezone

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, ConfigDict
from sqlalchemy.orm import Session

from app.database import get_db
from app.middleware.audit import log_action
from app.middleware.auth import get_current_user
from app.middleware.rbac import require_role
from app.models import User, UserRole

router = APIRouter()


class UserResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    username: str
    email: str
    role: str
    is_active: bool
    # ISO-8601 with explicit +00:00; SQLite drops tzinfo but every write
    # uses utcnow() so re-attaching UTC is always correct.
    created_at: str | None = None


class UserRoleUpdate(BaseModel):
    role: str


@router.get(
    "/users",
    response_model=list[UserResponse],
    dependencies=[Depends(require_role(["admin"]))],
)
def list_users(
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    users = db.query(User).order_by(User.id.asc()).all()
    return [
        UserResponse(
            id=u.id,
            username=u.username,
            email=u.email,
            role=u.role.value,
            is_active=u.is_active,
            created_at=u.created_at.replace(tzinfo=timezone.utc).isoformat() if u.created_at else None,
        )
        for u in users
    ]


@router.put(
    "/users/{user_id}/role",
    dependencies=[Depends(require_role(["admin"]))],
)
def update_user_role(
    user_id: int,
    req: UserRoleUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if current_user.id == user_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Cannot change your own role",
        )

    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    try:
        new_role = UserRole(req.role)
    except ValueError:
        allowed = ", ".join(r.value for r in UserRole)
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Invalid role '{req.role}'. Allowed: {allowed}",
        )

    old_role = user.role.value
    user.role = new_role
    db.commit()
    db.refresh(user)

    log_action(
        db, current_user.id, "update_user_role", "users",
        user.id, old_value=old_role, new_value=new_role.value,
    )

    return {"detail": f"User role updated to {new_role.value}", "user_id": user_id}
