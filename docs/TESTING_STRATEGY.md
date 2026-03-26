# AIHealthCheck Testing Strategy

This testing strategy is extracted directly from the ARTI-409-A Project Plan grading matrix. The minimum requirement for final submission is **5 unit tests + 2 integration tests**, however, our target is **8+ unit and 2 integration tests**.

## Unit Tests (Target: 8)

The backend team should use `pytest` to implement the following core unit tests:

1. `test_create_service`: Service registration creates correct DB record.
2. `test_test_connection`: Mock Claude API, verify latency calculation and status handling.
3. `test_eval_scoring`: Evaluation harness produces correct quality score from expected output.
4. `test_drift_detection`: Drift flag triggers appropriately when score drops below threshold.
5. `test_incident_creation`: Incident CRUD operations and strict field validation.
6. `test_rbac_viewer_blocked`: Ensure the Viewer role is strictly rejected from all mutation endpoints (`POST`, `PUT`, `DELETE`).
7. `test_audit_log_entry`: Verify that mutations automatically append audit records with correct metadata and timestamps.
8. `test_jwt_auth`: Validate Auth Token generation, signature validation, and internal role extraction.

## Integration Tests (Target: 2)

These tests evaluate end-to-end functionality across multiple systems spanning the SQLite DB and mock LLM wrapper:

1. `test_full_eval_pipeline`: Register Service → Trigger Evaluate → Fetch Dashboard metrics → Verify drift flag triggers if scores drop.
2. `test_incident_to_export`: Create Incident → Generate AI Summary → Approve Draft → Export PDF → Verify contents structurally.

## Execution Requirements
* All tests must pass gracefully without blank screen crashes or unhandled 500 exceptions.
* Use `pytest` for running suites.
* Ensure no actual Anthropic API keys are triggered during unit runs (MOCK the `llm_client.py` responses).
