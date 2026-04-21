"""
Sensitivity label enforcement.

Services tagged `confidential` are blocked from sending prompts to the
external LLM unless an admin explicitly overrides. This turns the
sensitivity label from a decorative field into a governance control.

Usage:
    from app.services.sensitivity import enforce_sensitivity
    enforce_sensitivity(db, service, current_user, allow_confidential=req.allow_confidential)
"""

from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from app.middleware.audit import log_action
from app.models import AIService, SensitivityLabel, User, UserRole


class ConfidentialBlockedError(HTTPException):
    """Raised when a confidential service is asked to reach the LLM without override."""

    def __init__(self, service_name: str):
        super().__init__(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=(
                f"Service '{service_name}' is labelled CONFIDENTIAL. "
                f"LLM calls require admin override (pass allow_confidential=true)."
            ),
        )


def enforce_sensitivity(
    db: Session,
    service: AIService,
    user: User,
    allow_confidential: bool = False,
) -> None:
    """
    Gate LLM access based on the service's sensitivity label.

    - public / internal: always allowed.
    - confidential:
        * blocked unless allow_confidential=True AND user is admin.
        * every attempt (allowed or denied) is recorded in the audit log.

    Raises ConfidentialBlockedError (403) when blocked. Returns None when allowed.
    """
    if service.sensitivity_label != SensitivityLabel.confidential:
        return

    # Confidential path — requires explicit override AND admin role.
    if not allow_confidential or user.role != UserRole.admin:
        log_action(
            db,
            user.id,
            "confidential_llm_blocked",
            "ai_services",
            service.id,
            old_value=f"sensitivity={service.sensitivity_label.value}",
            new_value=f"user_role={user.role.value},override={allow_confidential}",
        )
        raise ConfidentialBlockedError(service.name)

    log_action(
        db,
        user.id,
        "confidential_llm_override",
        "ai_services",
        service.id,
        old_value=f"sensitivity={service.sensitivity_label.value}",
        new_value=f"admin_override_by={user.email}",
    )
