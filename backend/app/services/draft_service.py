"""
Shared draft/approve helper for LLM-generated content.

Any surface that uses an LLM to produce output meant for governance-grade
consumption (dashboard insights, compliance reports, etc.) should route
through this service so:
  1. The raw LLM output is persisted as an UNAPPROVED draft first.
  2. A separate explicit approve() step records the human in the loop.
  3. Every create + approve is written to the audit log.

This is the abstraction called out in the audit as Arch Concern #2:
HITL was inconsistently applied across LLM surfaces. This centralises it.
"""

from datetime import datetime, timezone

from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from app.middleware.audit import log_action
from app.models import AILlmDraft


def create_draft(
    db: Session,
    surface: str,
    content: str,
    generated_by_user_id: int,
    surface_ref: str = "",
) -> AILlmDraft:
    """
    Persist an LLM output as an unapproved draft.
    Returns the saved AILlmDraft row.
    """
    draft = AILlmDraft(
        surface=surface,
        surface_ref=surface_ref,
        content=content,
        generated_by_user_id=generated_by_user_id,
    )
    db.add(draft)
    db.commit()
    db.refresh(draft)

    log_action(
        db,
        generated_by_user_id,
        "llm_draft_created",
        "ai_llm_drafts",
        draft.id,
        new_value=f"surface={surface}|ref={surface_ref}",
    )
    return draft


def approve_draft(db: Session, draft_id: int, approver_user_id: int) -> AILlmDraft:
    """
    Mark a draft as approved. Idempotency: re-approving is a 409.
    Records `llm_draft_approved` in the audit log with before/after state.
    """
    draft = db.query(AILlmDraft).filter(AILlmDraft.id == draft_id).first()
    if not draft:
        raise HTTPException(status_code=404, detail="Draft not found")

    if draft.approved_by_user_id is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Draft already approved",
        )

    draft.approved_by_user_id = approver_user_id
    draft.approved_at = datetime.now(timezone.utc).replace(tzinfo=None)
    db.commit()
    db.refresh(draft)

    log_action(
        db,
        approver_user_id,
        "llm_draft_approved",
        "ai_llm_drafts",
        draft.id,
        old_value=f"surface={draft.surface}|status=unapproved",
        new_value=f"surface={draft.surface}|status=approved",
    )
    return draft
