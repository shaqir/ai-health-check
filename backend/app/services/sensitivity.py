"""
Sensitivity label enforcement — disabled.

The sensitivity label (public / internal / confidential) remains as
metadata so teams can tag services, but it no longer gates LLM access.
Every label is free to send prompts to the LLM, matching the demo
requirement that all services be pingable against Claude.

`enforce_sensitivity` is kept as a no-op so callers don't need to
change their signatures. `ConfidentialBlockedError` is retained for
import-compatibility with any lingering references.
"""

from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from app.models import AIService, User


class ConfidentialBlockedError(HTTPException):
    """Retained for backward-compatibility. Never raised by enforce_sensitivity."""

    def __init__(self, service_name: str):
        super().__init__(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"Service '{service_name}' is labelled CONFIDENTIAL.",
        )


def enforce_sensitivity(
    db: Session,
    service: AIService,
    user: User,
    allow_confidential: bool = False,
) -> None:
    """No-op. Sensitivity labels are informational; all services may call the LLM."""
    return
