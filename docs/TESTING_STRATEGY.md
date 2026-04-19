# AI Health Check Testing Strategy

45 tests across 5 files. Framework: pytest. All tests run offline with no real API keys.

## Test Infrastructure

| Tool | Purpose |
|------|---------|
| In-memory SQLite | Fresh database per test session for full isolation |
| FastAPI TestClient | Synchronous HTTP client wrapping the ASGI app |
| Auth fixtures (`conftest.py`) | Pre-built JWT tokens for admin and viewer roles |
| Mocked LLM | All Anthropic API calls patched; no API key consumption |

## Test Files

| File | Count | Covers |
|------|-------|--------|
| `test_services.py` | 13 | Auth login, service CRUD, RBAC enforcement (viewer blocked from POST/PUT/DELETE), input validation, connection log persistence |
| `test_evaluations.py` | 11 | Test case CRUD, eval run lifecycle, drift severity (none/warning/critical), mocked LLM scoring, budget enforcement (402/429) |
| `test_dashboard.py` | 9 | Aggregated metrics, P50/P95/P99 percentiles, latency/quality/error trends, drift alerts, empty-state defaults |
| `test_compliance.py` | 10 | Audit log creation and filtering, user management, role updates, JSON export, RBAC on audit data, login attempt tracking |
| `test_integration.py` | 2 | Full service lifecycle (register, read, update, audit, delete), RBAC enforcement across all CRUD operations |
| **Total** | **45** | |

## Running Tests

```bash
cd backend
pytest -v
```

Expected output: `45 passed`

For architecture and endpoint details, see [ARCHITECTURE](ARCHITECTURE.md).
