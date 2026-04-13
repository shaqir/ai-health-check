# Risk Register

> Canonical source for risks and mitigations. For operational response procedures, see [MAINTENANCE_RUNBOOK.md](MAINTENANCE_RUNBOOK.md).

| ID | Risk | Likelihood | Impact | Status |
|----|------|-----------|--------|--------|
| R1 | PII Leakage | Medium | High | Implemented |
| R2 | Model Drift | High | High | Implemented |
| R3 | Hallucination | High | Medium | Implemented |
| R4 | Evaluation Bias | Medium | Medium | Implemented |
| R5 | Service Outage | Medium | Medium | Implemented |
| R6 | Cost Overrun | Medium | High | Implemented |
| R7 | Brute-Force | Medium | High | Implemented |
| R8 | Prompt Injection | High | High | Implemented |

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
