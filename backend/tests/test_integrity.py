"""
Data-integrity regression guards:
  1. SQLite foreign keys are enforced (no silent orphan rows).
  2. Concurrent log_action() calls produce a walkable chain.
"""

import threading

from sqlalchemy import text
from sqlalchemy.exc import IntegrityError

from app.middleware.audit import log_action, verify_audit_chain
from app.models import AIService, AuditLog, Environment, SensitivityLabel
from tests.conftest import TestSession


def test_foreign_keys_enforced(db):
    """
    Inserting a ConnectionLog that points at a non-existent service_id
    must fail with IntegrityError. Before the PRAGMA fix this silently
    succeeded and orphaned the row.
    """
    from app.models import ConnectionLog

    db.add(ConnectionLog(
        service_id=9999,          # no such service
        latency_ms=1.0,
        status="success",
    ))
    try:
        db.commit()
        raise AssertionError(
            "Insert with dangling FK should have been rejected by SQLite PRAGMA foreign_keys=ON"
        )
    except IntegrityError:
        db.rollback()


def test_concurrent_audit_writes_build_walkable_chain(db):
    """
    Fire 10 log_action() calls from 10 threads. Every row must commit
    with a distinct prev_hash and the chain must verify as intact.
    Without the threading.Lock this test consistently broke the chain.
    """
    # Each thread gets its own session — simulates real FastAPI workers.
    errors = []

    def worker(n):
        s = TestSession()
        try:
            log_action(s, None, f"concurrent_{n}", "t", n, new_value=str(n))
        except Exception as exc:
            errors.append(exc)
        finally:
            s.close()

    threads = [threading.Thread(target=worker, args=(i,)) for i in range(10)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()

    assert not errors, f"Worker raised: {errors}"

    # All 10 rows landed
    rows = db.query(AuditLog).order_by(AuditLog.id.asc()).all()
    assert len(rows) == 10

    # Every prev_hash is unique (no two rows linked to the same parent)
    prev_hashes = [r.prev_hash for r in rows]
    assert len(set(prev_hashes)) == 10

    # The full chain still walks
    result = verify_audit_chain(db)
    assert result["valid"] is True
    assert result["total"] == 10


def test_audit_timestamps_monotonic_under_lock(db):
    """Sanity: the lock keeps ordering stable — id order matches timestamp order."""
    log_action(db, None, "a", "t", 1)
    log_action(db, None, "b", "t", 2)
    log_action(db, None, "c", "t", 3)

    rows = db.query(AuditLog).order_by(AuditLog.id.asc()).all()
    timestamps = [r.timestamp for r in rows]
    assert timestamps == sorted(timestamps)
