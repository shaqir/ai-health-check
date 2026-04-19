# AI Health Check Testing Strategy

78 tests across 8 files. Framework: pytest. All tests run offline with no real API keys.
Coverage floor: 65% (currently ~71%).

## Test Infrastructure

| Tool | Purpose |
|------|---------|
| In-memory SQLite | Fresh database per test session for full isolation |
| FastAPI TestClient | Synchronous HTTP client wrapping the ASGI app |
| Auth fixtures (`conftest.py`) | Pre-built JWT tokens for admin, maintainer, and viewer roles |
| Mocked LLM | All Anthropic API calls patched; no API key consumption |
| Audit-log triggers | SQLite append-only triggers installed in `setup_db` fixture and dropped in teardown |
| pytest-cov | Coverage report with 65% floor; configured in `pyproject.toml` |

## Test Files

| File | Count | Covers |
|------|-------|--------|
| `test_services.py` | 17 | Auth login, service CRUD, RBAC enforcement (viewer blocked from POST/PUT/DELETE), input validation, connection log persistence, confidential sensitivity label enforcement + admin override |
| `test_evaluations.py` | 14 | Test case CRUD, eval run lifecycle, drift severity (none/warning/critical), mocked LLM scoring, budget enforcement (402/429), drift-triggered Alert creation, alert creation audited |
| `test_dashboard.py` | 9 | Aggregated metrics, P50/P95/P99 percentiles, latency/quality/error trends, drift alerts, empty-state defaults |
| `test_compliance.py` | 19 | Audit log creation and filtering, user management, role updates, JSON + PDF export with incidents + maintenance, RBAC on audit data, viewer + maintainer denied audit log, role-denied audited, hash-chain integrity verify, tamper detection, append-only triggers |
| `test_drafts.py` | 8 | HITL draft/approve flow for dashboard insights and compliance AI report (create unapproved, approve flips fields + audits, viewer cannot approve, admin-only for compliance, double-approve 409, recent filtering) |
| `test_draft_service.py` | 5 | Unit tests for the shared draft service abstraction |
| `test_auth.py` | 4 | Login success / failure / lockout mirrored from LoginAttempt to AuditLog |
| `test_integration.py` | 2 | Full service lifecycle (register, read, update, audit, delete), RBAC enforcement across all CRUD operations |
| **Total** | **78** | |

## Running Tests

```bash
cd backend
pytest -v
# or with coverage report
pytest --cov=app --cov-report=term-missing
```

Expected output: `78 passed` with coverage ≥ 65%.

## What's exercised end-to-end

- **Security gates**: every RBAC-protected endpoint is hit with at least one unauthorized role to confirm 403.
- **Audit chain**: happy path (3 rows, chain intact) + active tamper (drop trigger, UPDATE, restore trigger, verify reports broken_at).
- **HITL**: incident summary draft → approve → export contains it; unapproved draft does NOT appear in export.
- **Sensitivity**: confidential service blocked for non-admin, blocked for admin without override, allowed with override (and audited).
- **Budget / rate limit**: mocked to trigger 402 and 429 response paths.
- **Drift → Alert → Audit**: low score triggers drift flag, Alert row created, creation written to AuditLog.

For architecture and endpoint details, see [ARCHITECTURE](ARCHITECTURE.md).
