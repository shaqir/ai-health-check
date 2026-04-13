# AIHealthCheck Testing Strategy

## Overview

The AIHealthCheck backend has 45 tests across 5 test files. All tests run without network access or valid API credentials. The suite covers CRUD operations, RBAC enforcement, drift detection, budget limits, safety scanning, audit logging, authentication, performance metrics, and end-to-end integration flows.

## Test Infrastructure

| Component | Detail |
|-----------|--------|
| Framework | pytest |
| Database | In-memory SQLite, created fresh per test session for full isolation |
| HTTP Client | FastAPI TestClient (synchronous wrapper around the ASGI app) |
| Auth Fixtures | Pre-built JWT tokens for admin and viewer roles, defined in `conftest.py` |
| LLM Mocking | All Anthropic API calls are mocked; no real API keys are consumed during test runs |

## Test Files

| File | Tests | Coverage |
|------|-------|----------|
| `test_services.py` | 13 | Service CRUD, RBAC enforcement (viewer blocked from POST/PUT/DELETE, admin has full access), input validation (malformed/missing fields), connection log persistence |
| `test_evaluations.py` | 11 | Evaluation lifecycle (create test cases, trigger runs, retrieve results), drift severity classification (none/warning/critical), trend analysis, per-test tracking, mocked LLM scoring, budget enforcement (HTTP 402/429) |
| `test_dashboard.py` | 10 | Aggregated latency/error-rate/throughput/efficiency metrics, P50/P95/P99 percentile calculations, error categorization by type, multi-service dashboard summaries, empty-state defaults |
| `test_compliance.py` | 10 | Automatic audit log creation on mutations (service creation, incident updates, role changes), date-range filtering and JSON export, RBAC on audit data (viewer reads but cannot tamper), LoginAttempt tracking |
| `test_integration.py` | 2 | Full pipeline: register service, trigger evaluation, fetch dashboard metrics, verify drift flags. Incident-to-export flow: create incident, generate AI summary (mocked), approve draft, verify export structure |

## Coverage Summary

| Feature Area | Tested By | Status |
|-------------|-----------|--------|
| Service CRUD | `test_services.py` | Covered |
| RBAC (admin vs. viewer) | `test_services.py`, `test_compliance.py` | Covered |
| Drift detection (severity, trend, variance) | `test_evaluations.py` | Covered |
| Budget enforcement (daily/monthly, HTTP 402/429) | `test_evaluations.py` | Covered |
| Prompt safety scanner (injection, PII, length) | `test_evaluations.py` | Covered |
| Audit logging and compliance export | `test_compliance.py` | Covered |
| JWT authentication and login throttling | `test_compliance.py` | Covered |
| Performance metrics (P50/P95/P99, throughput) | `test_dashboard.py` | Covered |
| Input validation (field length, required fields) | `test_services.py` | Covered |
| Cross-module integration | `test_integration.py` | Covered |

## Running Tests

```bash
cd backend
pytest -v
```

Expected output:

```
45 passed
```

To run a single file:

```bash
pytest tests/test_services.py -v
```

To run with coverage reporting:

```bash
pytest --cov=app -v
```
