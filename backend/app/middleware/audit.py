"""
Audit logging helper with tamper-evident hash chain.

Every log_action() call commits a SHA-256 hash over the row's content plus
the previous row's hash. Any UPDATE or DELETE on a past row breaks the
chain and is detectable via verify_audit_chain().

Defence in depth: the SQLite triggers registered in main.py block
UPDATE/DELETE from the application path so the only way to tamper is a
direct DB connection — which the hash chain detects on next verify.
"""

import hashlib
import threading
from datetime import datetime, timezone

from sqlalchemy.orm import Session
from app.models import AuditLog

GENESIS_HASH = "0" * 64

# Serialises log_action() inside a single process. Without this, two
# concurrent requests both read the same "last row", compute the same
# prev_hash, and commit — producing two rows with the same prev_hash
# and corrupting the chain under normal concurrent use.
#
# For multi-worker deployments this would need a DB-native lock
# (SELECT ... FOR UPDATE on Postgres, or an advisory lock). For the
# single-process SQLite dev/test environment this is sufficient.
_AUDIT_LOCK = threading.Lock()


def _compute_content_hash(
    user_id: int | None,
    action: str,
    target_table: str,
    target_id: int | None,
    old_value: str,
    new_value: str,
    timestamp_iso: str,
    prev_hash: str,
) -> str:
    """SHA-256 over the canonical string representation of the row + chain link."""
    payload = "|".join([
        str(user_id) if user_id is not None else "",
        action,
        target_table,
        str(target_id) if target_id is not None else "",
        old_value or "",
        new_value or "",
        timestamp_iso,
        prev_hash,
    ])
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


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
    Record an action in the audit log with a hash-chain link.
    Called after every create, update, or delete operation.
    """
    # Hold the lock across read-of-previous, hash computation, insert,
    # and commit so two concurrent callers never link to the same
    # prev_hash. Keep the critical section small — just DB work.
    with _AUDIT_LOCK:
        prev_row = db.query(AuditLog).order_by(AuditLog.id.desc()).first()
        prev_hash = (prev_row.content_hash or GENESIS_HASH) if prev_row else GENESIS_HASH

        # Compute timestamp + hash BEFORE insert so the row is immutable once written.
        # The append-only trigger would reject an UPDATE after flush.
        # Use tz-naive datetime so SQLite round-trip preserves the isoformat
        # string used in the hash (SQLite DateTime columns drop tzinfo).
        timestamp = datetime.now(timezone.utc).replace(tzinfo=None)
        content_hash = _compute_content_hash(
            user_id=user_id,
            action=action,
            target_table=target_table,
            target_id=target_id,
            old_value=old_value,
            new_value=new_value,
            timestamp_iso=timestamp.isoformat(),
            prev_hash=prev_hash,
        )

        entry = AuditLog(
            user_id=user_id,
            action=action,
            target_table=target_table,
            target_id=target_id,
            old_value=old_value,
            new_value=new_value,
            timestamp=timestamp,
            prev_hash=prev_hash,
            content_hash=content_hash,
        )
        db.add(entry)
        db.commit()


def verify_audit_chain(db: Session) -> dict:
    """
    Walk the audit log in chronological order and verify every hash.
    Returns: {total, valid (bool), broken_at (id or None), reason}
    """
    rows = db.query(AuditLog).order_by(AuditLog.id.asc()).all()
    if not rows:
        return {"total": 0, "valid": True, "broken_at": None, "reason": ""}

    expected_prev = GENESIS_HASH
    for row in rows:
        # 1. Check the link to the previous row
        if (row.prev_hash or "") != expected_prev:
            return {
                "total": len(rows),
                "valid": False,
                "broken_at": row.id,
                "reason": "prev_hash mismatch — a prior row was modified or deleted",
            }

        # 2. Recompute this row's content hash
        recomputed = _compute_content_hash(
            user_id=row.user_id,
            action=row.action,
            target_table=row.target_table,
            target_id=row.target_id,
            old_value=row.old_value or "",
            new_value=row.new_value or "",
            timestamp_iso=row.timestamp.isoformat() if row.timestamp else "",
            prev_hash=row.prev_hash or "",
        )
        if recomputed != (row.content_hash or ""):
            return {
                "total": len(rows),
                "valid": False,
                "broken_at": row.id,
                "reason": "content_hash mismatch — this row was modified in place",
            }

        expected_prev = row.content_hash or ""

    return {"total": len(rows), "valid": True, "broken_at": None, "reason": ""}
