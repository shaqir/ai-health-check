"""
Audit logging helper.
Call log_action() after any mutation to record it in the audit_log table.
"""

from sqlalchemy.orm import Session
from app.models import AuditLog


def log_action(
    db: Session,
    user_id: int | None,
    action: str,
    target_table: str,
    target_id: int | None = None,
    old_value: str = "",
    new_value: str = "",
):
    """
    Record an action in the audit log.
    Called after every create, update, or delete operation.
    """
    entry = AuditLog(
        user_id=user_id,
        action=action,
        target_table=target_table,
        target_id=target_id,
        old_value=old_value,
        new_value=new_value,
    )
    db.add(entry)
    db.commit()
