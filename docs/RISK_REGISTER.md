# Risk Register

> Canonical source for risks and mitigations. For operational response procedures, see [MAINTENANCE_RUNBOOK.md](MAINTENANCE_RUNBOOK.md).

| ID | Risk | Likelihood | Impact | Status |
|----|------|-----------|--------|--------|
| R1  | PII Leakage | Medium | High | Implemented |
| R2  | Model Drift | High | High | Implemented |
| R3  | Hallucination | High | Medium | Implemented |
| R4  | Evaluation Bias | Medium | Medium | Implemented |
| R5  | Service Outage | Medium | Medium | Implemented |
| R6  | Cost Overrun | Medium | High | Implemented |
| R7  | Brute-Force | Medium | High | Implemented |
| R8  | Prompt Injection | High | High | Implemented |
| R9  | Audit Log Tampering | Low | Critical | Implemented |
| R10 | Confidential Data Leakage via LLM | Medium | Critical | Implemented |
| R11 | Unapproved LLM Output Treated as Official | Medium | High | Implemented |
| R12 | Privileged Data Read by Viewer Role | Medium | High | Implemented |

---

### R1: PII Leakage

Sensitive data sent to or returned from the cloud LLM.

- `scan_input()` in `safety.py` detects email, phone, SSN, and credit card via compiled regex before any prompt reaches Claude
- `scan_output()` in `safety.py` flags PII in responses; blocks those containing SSN or credit card (`safe` returns false)
- All outbound API calls routed through `llm_client.py` -- no route handler touches the Anthropic SDK
- `sanitize_text()` in `safety.py` strips control characters and HTML-encodes angle brackets

Residual: PII in formats not matching the four regex patterns will pass through undetected.

---

### R2: Model Drift

Anthropic updates Claude and response quality degrades silently.

- Eval harness produces quality scores (0-100); drift threshold at 75% triggers flag
- Per-test tracking via `EvalResult` model stores score, latency, and response per test case per run
- Drift severity (none/warning/critical) and trend analysis documented in [EVAL_DATASET_CARD.md](EVAL_DATASET_CARD.md)
- APScheduler runs evaluations on a configurable recurring schedule
- Auto-alert creation via the `Alert` model when drift is detected (alert_type, severity, message, service_id); alerts can be acknowledged via `POST /alerts/{id}/acknowledge`

Residual: Small test dataset (2 cases per service) may miss category-specific degradation.

---

### R3: Hallucination

Claude generates plausible but incorrect root causes or summaries.

- LLM output stored in `summary_draft` holding field; requires explicit approval via `approved_by`
- `score_factuality()` in `llm_client.py` rates factual similarity 0-100 during eval runs (see [PROMPT_CHANGE_LOG.md](PROMPT_CHANGE_LOG.md) for prompt template)
- `detect_hallucination()` in `llm_client.py` scores unsupported or fabricated claims 0-100 (0 = no hallucination, 100 = severe); result stored in `EvalRun.hallucination_score` (see [PROMPT_CHANGE_LOG.md](PROMPT_CHANGE_LOG.md) for prompt template)

Residual: Human reviewer may lack domain knowledge to catch subtle inaccuracies.

---

### R4: Evaluation Bias

Claude consistently favors certain root causes or phrases recommendations in biased ways.

- Human review of every LLM suggestion before it enters the incident record
- Per-test-case breakdown in drift-check endpoint shows individual performance and trends
- Eval test cases span multiple categories (factuality, format_json) per [EVAL_DATASET_CARD.md](EVAL_DATASET_CARD.md)

Residual: All test cases are English-only and synthetically generated.

---

### R5: Service Outage

Anthropic API goes down or rate limits are hit during operations.

- `_make_api_call()` in `llm_client.py` retries with exponential backoff: `2^attempt + random(0, 0.5)` sec, max 2 retries for `RateLimitError`, `APIConnectionError`, `InternalServerError`
- `test_connection()` in `llm_client.py` verifies API availability (max_tokens=50, catches all exceptions)
- Incident workflow (create, triage, checklist) operates fully without the LLM

Residual: Extended Anthropic outages (>2h) block summary generation and evaluations.

---

### R6: Cost Overrun

Automated evaluations or heavy usage exceeds budget.

- `_check_budget()` in `llm_client.py` enforces daily ($5) and monthly ($25) limits before every call
- Per-call cost estimation using `_estimate_cost()` at Sonnet 4.6 pricing ($3/M input, $15/M output)
- Every call logged to `api_usage_log` with `estimated_cost_usd`; `BudgetExceededError` raised at HTTP 402
- Rate limits: 10 calls/min global, 5 calls/min per-user

Residual: Token-based estimation is approximate; actual Anthropic billing may differ.

---

### R7: Brute-Force

Attacker gains access by repeatedly guessing passwords.

- `LoginAttempt` model records every attempt with email, IP, and timestamp
- After 5 failures within 15 minutes for the same email, HTTP 429 blocks further attempts
- Throttle check runs before password verification, preventing timing-based information leakage

Residual: Only email-based throttling; no IP-based rate limiting at the application level.

---

### R8: Prompt Injection

Malicious input manipulates Claude or extracts internal instructions.

- `scan_input()` in `safety.py` checks 15 compiled regex patterns (instruction override, role manipulation, system prompt extraction, known exploits)
- Risk scoring: 40 pts per injection match, 20 per PII type, 15 for length warning (>80% of 10k char max), 100 for length exceeded
- Block threshold: risk >= 80; raises `PromptSafetyError` (HTTP 422); logged as `blocked_safety`
- `scan_output()` detects model refusal patterns in Claude responses

Residual: Regex-based detection cannot catch novel or obfuscated injection techniques.

---

### R9: Audit Log Tampering

An insider or intruder modifies or deletes past audit rows to hide activity.

- Every audit row commits a SHA-256 `content_hash` computed over its content plus the previous row's hash (`middleware/audit.py`) — a modified row breaks the chain and is detectable by replaying it.
- SQLite `BEFORE UPDATE` and `BEFORE DELETE` triggers on `audit_log` reject mutations from the application path (`main.py:_install_audit_log_triggers`).
- `GET /compliance/audit-log/verify` (admin-only) walks the chain and reports `{total, valid, broken_at, reason}`. Surfaced in the Governance UI as "Verify integrity."
- Role-denied attempts on sensitive endpoints are themselves audited (`role_denied` action) so probing is visible to reviewers.

Residual: Production should use Postgres row permissions or a WORM-enforced audit service. The SQLite triggers can be bypassed by a direct DB connection, but the hash chain still detects the resulting tamper on next verify.

---

### R10: Confidential Data Leakage via LLM

A service labelled `confidential` reaches the external LLM without explicit governance sign-off.

- `app/services/sensitivity.py:enforce_sensitivity()` gates every LLM call tied to a service (test-connection, eval run, incident summary).
- `confidential` services are blocked unless the caller passes `allow_confidential=true` AND holds the admin role. Non-admins are rejected even with the flag.
- Every attempt (allowed or denied) writes to the audit log (`confidential_llm_override` / `confidential_llm_blocked`).
- Frontend shows a confirm dialog before admins can override.

Residual: The `public` / `internal` labels do not trigger any additional controls. Misclassification of a confidential service as internal is undetected.

---

### R11: Unapproved LLM Output Treated as Official

LLM-generated content is consumed as authoritative without human review.

- Incident summaries: written to `Incident.summary_draft`. Published as `Incident.summary` only via explicit `POST /incidents/{id}/approve-summary` which records `approved_by`.
- Maintenance plans: `approved` defaults `False`. Flipped by `POST /maintenance/{id}/approve`.
- Dashboard insights + compliance AI reports: persisted as unapproved `AILlmDraft` rows by the shared `draft_service`. Separate approve endpoint flips `approved_by_user_id` and writes `llm_draft_approved` to the audit log.
- Compliance export excludes unapproved incident summaries — drafts never appear in the official record.

Residual: Humans approving without reading the content are still the weak link. Mitigated by presenting the full draft in the UI alongside the Approve button.

---

### R12: Privileged Data Read by Viewer Role

Viewer token can query governance-grade endpoints intended for admins.

- `GET /compliance/audit-log` is `require_role(["admin"])` (as is `/audit-log/verify`, `/users`, `/users/{id}/role`, and the AI compliance report endpoints).
- `require_role` middleware (`middleware/rbac.py`) writes a `role_denied` row to the audit log for every 403 so probing is traceable.
- Frontend conditionally omits the audit-log fetch for non-admins to avoid misleading "failed to load" errors.

Residual: Generic list endpoints (e.g. `/services`, `/incidents`) are authenticated but not role-scoped by design — any logged-in user can read operational state. This is consistent with the spec's Viewer = "read-only" role.
