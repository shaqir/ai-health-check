"""
Auth Router — Login, Register, and Recovery endpoints with login throttling.
POST /api/v1/auth/login    → Public (rate limited: 5 attempts per 15 min)
POST /api/v1/auth/register → Admin only
POST /api/v1/auth/recover  → Public (requires ADMIN_RECOVERY_KEY)
"""

from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.security import OAuth2PasswordRequestForm
from sqlalchemy.orm import Session
from sqlalchemy import func
from pydantic import BaseModel

from app.config import get_settings
from app.database import get_db
from app.models import User, UserRole, LoginAttempt
from app.middleware.auth import (
    hash_password, verify_password, create_access_token, get_current_user,
)
from app.middleware.rbac import require_role
from app.middleware.audit import log_action

router = APIRouter()
settings = get_settings()


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


def _check_login_throttle(email: str, db: Session):
    """Check if this email has too many recent failed login attempts."""
    cutoff = datetime.now(timezone.utc) - timedelta(minutes=settings.login_lockout_minutes)
    failed_count = db.query(func.count(LoginAttempt.id)).filter(
        LoginAttempt.email == email,
        LoginAttempt.success == False,
        LoginAttempt.timestamp >= cutoff,
    ).scalar()

    if failed_count >= settings.max_login_attempts:
        # Surface lockouts in the audit log so repeated brute-force
        # attempts are visible during compliance review.
        log_action(
            db, None, "login_lockout", "users", None,
            new_value=f"email={email},failed_count={failed_count}",
        )
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail=f"Too many failed login attempts. Try again in {settings.login_lockout_minutes} minutes.",
        )


def _record_login_attempt(email: str, success: bool, ip_address: str, db: Session):
    """Record a login attempt for throttling."""
    db.add(LoginAttempt(email=email, success=success, ip_address=ip_address))
    db.commit()


@router.post("/login", response_model=TokenResponse)
def login(
    request: Request,
    form_data: OAuth2PasswordRequestForm = Depends(),
    db: Session = Depends(get_db),
):
    """Authenticate user and return JWT token. Rate limited to prevent brute force."""
    email = form_data.username
    ip_address = request.client.host if request.client else ""

    # Check throttle before attempting auth
    _check_login_throttle(email, db)

    user = db.query(User).filter(User.email == email).first()
    if not user or not verify_password(form_data.password, user.password_hash):
        _record_login_attempt(email, False, ip_address, db)
        # Mirror to audit log so governance reviewers see auth failures
        # alongside all other state changes. user_id is None because the
        # credential didn't match any user (don't leak which exists).
        log_action(
            db, None, "login_failed", "users", None,
            new_value=f"email={email},ip={ip_address}",
        )
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid email or password",
        )

    # Successful login
    _record_login_attempt(email, True, ip_address, db)
    log_action(
        db, user.id, "login_success", "users", user.id,
        new_value=f"ip={ip_address}",
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
