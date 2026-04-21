"""
Auth Router — Login, Register, and Recovery endpoints.
POST /api/v1/auth/login    → Public
POST /api/v1/auth/register → Admin only
POST /api/v1/auth/recover  → Public (requires ADMIN_RECOVERY_KEY)
"""

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import OAuth2PasswordRequestForm
from sqlalchemy.orm import Session
from pydantic import BaseModel

from app.database import get_db
from app.models import User, UserRole
from app.config import get_settings
from app.middleware.auth import (
    hash_password, verify_password, create_access_token, get_current_user,
)
from app.middleware.rbac import require_role
from app.middleware.audit import log_action

router = APIRouter()


class RegisterRequest(BaseModel):
    username: str
    email: str
    password: str
    role: str = "viewer"  # admin, maintainer, viewer


class RecoverRequest(BaseModel):
    recovery_key: str
    email: str
    new_password: str


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user_id: int
    username: str
    role: str


@router.post("/login", response_model=TokenResponse)
def login(
    form_data: OAuth2PasswordRequestForm = Depends(),
    db: Session = Depends(get_db),
):
    """Authenticate user and return JWT token."""
    user = db.query(User).filter(User.email == form_data.username).first()
    if not user or not verify_password(form_data.password, user.password_hash):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid email or password",
        )

    token = create_access_token(data={"sub": str(user.id), "role": user.role.value})
    return TokenResponse(
        access_token=token,
        user_id=user.id,
        username=user.username,
        role=user.role.value,
    )


@router.post(
    "/register",
    response_model=TokenResponse,
    dependencies=[Depends(require_role(["admin"]))],
)
def register(
    req: RegisterRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Create a new user (Admin only)."""
    # Check if user already exists
    existing = db.query(User).filter(
        (User.email == req.email) | (User.username == req.username)
    ).first()
    if existing:
        raise HTTPException(status_code=400, detail="User already exists")

    user = User(
        username=req.username,
        email=req.email,
        password_hash=hash_password(req.password),
        role=UserRole(req.role),
    )
    db.add(user)
    db.commit()
    db.refresh(user)

    # Audit log
    log_action(db, current_user.id, "create_user", "users", user.id, new_value=req.username)

    token = create_access_token(data={"sub": str(user.id), "role": user.role.value})
    return TokenResponse(
        access_token=token,
        user_id=user.id,
        username=user.username,
        role=user.role.value,
    )


@router.post("/recover")
def recover_admin(
    req: RecoverRequest,
    db: Session = Depends(get_db),
):
    """
    Emergency admin password reset — public endpoint secured by
    ADMIN_RECOVERY_KEY (set in .env). Does NOT require authentication.
    """
    settings = get_settings()

    # Guard: recovery must be enabled
    if not settings.admin_recovery_key:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Recovery is not configured on this server.",
        )

    # Guard: validate the recovery key
    if req.recovery_key != settings.admin_recovery_key:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Invalid recovery key.",
        )

    # Find the user
    user = db.query(User).filter(User.email == req.email).first()
    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="No account found with that email.",
        )

    # Reset password and re-activate
    user.password_hash = hash_password(req.new_password)
    user.is_active = True
    db.commit()

    # Audit log (user_id=None since this is unauthenticated)
    log_action(db, None, "admin_recovery_password_reset", "users", user.id,
               new_value=f"Password reset via recovery key for {user.email}")

    return {"message": f"Password reset successfully for {user.username}."}


@router.get("/recovery-status")
def recovery_status():
    """Check if admin recovery is enabled (no secrets exposed)."""
    settings = get_settings()
    return {"enabled": bool(settings.admin_recovery_key)}


@router.get("/me")
def get_me(current_user: User = Depends(get_current_user)):
    """Return current user info."""
    return {
        "id": current_user.id,
        "username": current_user.username,
        "email": current_user.email,
        "role": current_user.role.value,
    }
