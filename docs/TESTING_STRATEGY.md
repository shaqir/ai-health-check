# AI Health Check Testing Strategy

> Last updated: 2026-04-18 · current as of commit `3396e21`

123 tests across 13 files. Framework: pytest. All tests run offline with no real API keys.
Coverage floor: 65% (currently ~71%).

## Test Infrastructure

| Tool | Purpose |
|------|---------|
| In-memory SQLite | Fresh database per test session for full isolation |
| FastAPI TestClient | Synchronous HTTP client wrapping the ASGI app |
| Auth fixtures (`conftest.py`) | Pre-built JWT tokens for admin, maintainer, and viewer roles |
| Mocked LLM | All Anthropic API calls patched; no API key consumption |
| Audit-log triggers | SQLite append-only triggers installed in `setup_db` fixture and dropped in teardown |
| DNS stub | `socket.getaddrinfo` stubbed to a public IP for test hostnames; SSRF tests override with literal IPs |
| FK enforcement | `PRAGMA foreign_keys=ON` set on every SQLite connection via engine event |
| pytest-cov | Coverage report with 65% floor; configured in `pyproject.toml` |

## Test Files

| File | Count | Covers |
|------|-------|--------|
| `test_services.py` | 21 | Auth login, service CRUD, RBAC enforcement (viewer blocked from POST/PUT/DELETE), input validation, connection log persistence, confidential sensitivity enforcement + admin override, SSRF rejection at registration/update (metadata URL, file://, private IP rebinding) |
| `test_evaluations.py` | 14 | Test case CRUD, eval run lifecycle, drift severity (none/warning/critical), mocked LLM scoring, budget enforcement (402/429), drift-triggered Alert creation, alert creation audited |
| `test_dashboard.py` | 9 | Aggregated metrics, P50/P95/P99 percentiles, latency/quality/error trends, drift alerts, empty-state defaults |
| `test_compliance.py` | 24 | Audit log creation and filtering, user management, role updates, JSON + PDF export with incidents + maintenance, RBAC on audit data, viewer + maintainer denied audit log, role-denied audited, hash-chain integrity verify, tamper detection, append-only triggers, strict date parsing (400 on malformed from_date / to_date / inverted range), truncation warnings |
| `test_drafts.py` | 8 | HITL draft/approve flow for dashboard insights and compliance AI report (create unapproved, approve flips fields + audits, viewer cannot approve, admin-only for compliance, double-approve 409, recent filtering) |
| `test_draft_service.py` | 5 | Unit tests for the shared draft service abstraction |
| `test_incidents.py` | 6 | Incident summary approval: missing reviewer_note rejected (422), short note rejected (422), whitespace-only note rejected (400), valid note succeeds and persists attribution, double-approval returns 409, no-draft returns 400 |
| `test_auth.py` | 4 | Login success / failure / lockout mirrored from LoginAttempt to AuditLog |
| `test_url_validator.py` | 10 | SSRF guard — metadata service blocked, loopback blocked, RFC1918 blocked, non-http scheme blocked, IPv6 loopback blocked, mixed public/private DNS resolution blocked, unresolvable hostname rejected, public IP allowed, empty URL rejected |
| `test_integrity.py` | 3 | SQLite FK enforcement (dangling FK rejected), 10 concurrent log_action calls produce a walkable chain with 10 distinct prev_hashes, chain timestamps monotonic under the lock |
| `test_judge_parser.py` | 13 | LLM judge response parsing — bare numbers accepted, refusal phrasings rejected (including "I can give you 7 reasons" and "I cannot rate this. 404"), over-range clamped, whitespace tolerated |
| `test_budget_race.py` | 1 | 20 concurrent `_make_api_call` invocations against a rate limit of 5 — asserts at most 5 succeed; the lock + reservation pattern prevents race-condition bypass |
| `test_integration.py` | 2 | Full service lifecycle (register, read, update, audit, delete), RBAC enforcement across all CRUD operations |
| **Total** | **123** | |

## Running Tests

```bash
cd backend
pytest -v
# or with coverage report
pytest --cov=app --cov-report=term-missing
```

Expected output: `123 passed` with coverage ≥ 65%.

## What's exercised end-to-end

- **Security gates**: every RBAC-protected endpoint is hit with at least one unauthorized role to confirm 403.
- **Audit chain**: happy path (3 rows, chain intact) + active tamper (drop trigger, UPDATE, restore trigger, verify reports broken_at) + concurrent writes (10 threads, 10 distinct prev_hashes).
- **HITL**: incident summary draft → approve with mandatory reviewer_note → export contains it; unapproved draft does NOT appear in export; double approval returns 409.
- **Sensitivity**: confidential service blocked for non-admin, blocked for admin without override, allowed with override (and audited).
- **SSRF**: metadata service URL, file://, private IP rebinding all rejected at both registration and probe time.
- **Budget / rate limit**: mocked to trigger 402 and 429 response paths; 20 concurrent callers with rate_limit=5 yield at most 5 successes.
- **Drift → Alert → Audit**: low score triggers drift flag, Alert row created, creation written to AuditLog.
- **Judge parsing**: refusals like "I cannot rate this" return None rather than being misread as 0 or 100.
- **FK integrity**: dangling service_id rejected by SQLite (with `foreign_keys=ON`).

For architecture and endpoint details, see [ARCHITECTURE](ARCHITECTURE.md).
