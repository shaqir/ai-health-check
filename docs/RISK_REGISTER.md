# Model Risk Register

> ARTI-409-A | AIHealthCheck
> v3 (Final)

---

## Risk Summary

| ID | Risk | Likelihood | Impact | Mitigation Controls | Status |
|----|------|-----------|--------|---------------------|--------|
| R1 | Data Privacy / PII Leakage | Medium | High | Safety scanner PII detection (email, phone, SSN, credit card); sensitivity labels on services; output scanner blocks SSN and credit card in responses; all LLM calls routed through llm_client.py | Implemented |
| R2 | Model Drift / Quality Degradation | High | High | Drift detection with severity levels (none/warning/critical); trend analysis via first-half vs second-half comparison; variance calculation; confidence scoring (low/medium/high); 75% threshold; per-test EvalResult tracking | Implemented |
| R3 | LLM Hallucination | High | Medium | score_factuality function rates factual accuracy 0-100; human-in-the-loop approval required before saving any LLM output; summary_draft holding field | Implemented |
| R4 | Evaluation Bias | Medium | Medium | Per-test-case tracking via EvalResult model; multiple eval categories (factuality, format_json); individual test trend analysis in drift-check endpoint | Implemented |
| R5 | Service Outage | Medium | Medium | Exponential backoff retry (2^attempt + jitter, max 2 retries) for RateLimitError, APIConnectionError, InternalServerError; categorized error logging; health checks via APScheduler | Implemented |
| R6 | API Cost Overrun | Medium | High | Daily $5 and monthly $25 budget limits; per-call cost estimation at Sonnet 4.6 pricing; APIUsageLog tracks every call with cost; BudgetExceededError at HTTP 402; cost preview endpoint | Implemented |
| R7 | Credential Brute-Force | Medium | High | Login throttling: 5 attempts per email within 15 minutes; LoginAttempt model records every attempt with IP and timestamp; HTTP 429 on lockout | Implemented |
| R8 | Prompt Injection Attack | High | High | Safety scanner with 15 compiled regex patterns; risk scoring 0-100 (40 per injection, 20 per PII type, 15 for length warning); block at risk >= 80; PromptSafetyError at HTTP 422; max 10,000 character prompt length | Implemented |

---

## Risk Details

### R1: Data Privacy / PII Leakage

**Scenario:** Sensitive data is sent to the cloud LLM or appears in LLM responses.

**Controls:**
- Every service requires a `sensitivity_label` field (public / internal / confidential)
- The Privacy Routing page documents what data leaves the server
- `scan_input()` in `safety.py` detects PII before prompts reach Claude: email addresses, phone numbers, SSNs, and credit card numbers
- `scan_output()` flags PII in Claude responses; blocks responses containing SSNs or credit card numbers (`safe` returns false)
- All outbound API calls are routed through `llm_client.py` -- no route handler touches the Anthropic SDK directly
- `sanitize_text()` strips control characters and HTML-encodes angle brackets

**Residual risk:** If an operator includes sensitive data in incident symptom descriptions in a format not matching the regex patterns, it could be sent to Claude. The PII patterns cover common formats but not all possible encodings.

---

### R2: Model Drift / Quality Degradation

**Scenario:** The Claude model is updated by Anthropic and response quality degrades without detection.

**Controls:**
- Evaluation harness runs synthetic test cases producing a quality score (0-100)
- Per-test-case tracking via the `EvalResult` model stores individual scores, latency, and response text
- Drift threshold: 75% (configurable via `DRIFT_THRESHOLD` environment variable)
- Drift severity levels:
  - **none** -- score >= threshold + 10 AND trend is not declining (equivalently, score >= 85% and stable or improving)
  - **warning** -- score within 10 points of threshold (75-85%) OR trend is declining
  - **critical** -- score < 75% threshold OR sudden drop > 15 points from previous average
- Trend analysis (`_compute_trend`): splits score history into two halves, compares averages; difference > 3.0 = improving, < -3.0 = declining, otherwise stable
- Variance: population variance formula across recent scores, rounded to 2 decimal places
- Confidence: low (1-2 runs), medium (3-4 runs), high (5+ runs)
- Dashboard shows quality trends, P50/P95/P99 latency percentiles, and per-test breakdowns
- APScheduler runs evaluations on a configurable recurring schedule

---

### R3: LLM Hallucination

**Scenario:** Claude generates plausible but incorrect root causes or incident summaries.

**Controls:**
- LLM output is stored in `summary_draft` -- a holding field that requires explicit approval
- The UI displays the draft for human review; nothing is saved to the permanent `summary` field until the operator clicks "Approve"
- `approved_by` records which user approved the summary
- `score_factuality` uses Claude to rate factual similarity between expected and actual outputs on a 0-100 scale, providing a quantitative check during evaluation runs

---

### R4: Evaluation Bias

**Scenario:** Claude consistently favors certain root causes or phrases recommendations in biased ways.

**Controls:**
- Human review of every LLM suggestion before it enters the incident record
- Audit log captures who approved what and when
- Evaluation test cases include multiple categories (factuality and format_json)
- Per-test-case breakdown in the drift-check endpoint shows individual test performance and trends, making it possible to identify if specific categories are underperforming

---

### R5: Service Outage

**Scenario:** Anthropic's API goes down or rate limits are hit during operations.

**Controls:**
- `test_connection` function verifies API availability (max_tokens=50, catches all exceptions gracefully)
- `_make_api_call` implements exponential backoff retry: `2^attempt + random(0, 0.5)` seconds delay, max 2 retries for transient errors (`RateLimitError`, `APIConnectionError`, `InternalServerError`)
- Categorized error logging: `error_timeout`, `error_rate_limit`, `error_server`, `error_auth`, `error_bad_request`, `error_unknown`
- Retry attempts logged as `retry_0`, `retry_1` for observability
- Incident workflow (create, triage, checklist) operates fully without the LLM
- APScheduler monitors connection health on a recurring interval

---

### R6: API Cost Overrun

**Scenario:** Automated evaluations or heavy usage causes spending to exceed the project budget.

**Controls:**
- Budget enforcement via `_check_budget()` runs before every API call
- Daily limit: $5.00 (configurable via `API_DAILY_BUDGET`); monthly limit: $25.00 (configurable via `API_MONTHLY_BUDGET`)
- Cost estimation per call using Claude Sonnet 4.6 pricing: $3.00/M input tokens, $15.00/M output tokens
- Every call logged to `api_usage_log` with `estimated_cost_usd`, token counts, and caller function name
- Global rate limit: 10 calls/min; per-user rate limit: 5 calls/min
- `BudgetExceededError` raised with HTTP 402 (budget) or HTTP 429 (rate limit)
- Cost preview endpoint (`/evaluations/cost-preview/{service_id}`) estimates cost before running evaluations
- Dashboard shows real-time budget usage percentage and remaining budget

**Residual risk:** Cost estimation is approximate since it uses token counts from response metadata. Actual Anthropic billing may differ slightly.

---

### R7: Credential Brute-Force

**Scenario:** An attacker attempts to gain access by repeatedly guessing user passwords.

**Controls:**
- Login throttling via the `LoginAttempt` model: every attempt (success and failure) is recorded with email, IP address, and timestamp
- After 5 failed attempts within 15 minutes for the same email, further attempts are blocked with HTTP 429
- Throttle check runs before password verification, preventing timing-based information leakage
- Configurable via `MAX_LOGIN_ATTEMPTS` (default: 5) and `LOGIN_LOCKOUT_MINUTES` (default: 15) environment variables
- Successful logins are also recorded for a complete audit trail

**Residual risk:** Only email-based throttling is implemented. An attacker could target multiple accounts from the same IP without triggering per-email lockout.

---

### R8: Prompt Injection Attack

**Scenario:** A malicious user crafts input to manipulate Claude's behavior or extract internal instructions.

**Controls:**
- `scan_input()` in `safety.py` scans all input before it reaches the Claude API
- 15 compiled regex patterns detect common injection techniques:
  - Instruction override: "ignore previous instructions", "disregard all previous", "forget all prior instructions"
  - Role manipulation: "you are now a", "act as if you are", "pretend you are"
  - System prompt extraction: "reveal your system prompt", "show your instructions", "repeat all your messages"
  - Known exploits: "jailbreak", "DAN mode", "developer mode enabled"
- Risk scoring with weighted contributions:
  - 40 points per injection pattern match
  - 20 points per PII type detected
  - 15 points for length warning (prompt > 80% of 10,000 character max)
  - 100 points (auto-block) for length exceeded
- Prompts with risk score >= 80 are blocked; `PromptSafetyError` raised with HTTP 422
- Blocked calls logged with status `blocked_safety`, safety_flags, and risk_score in `api_usage_log`
- `sanitize_text()` strips control characters, collapses excessive whitespace, and HTML-encodes angle brackets
- `scan_output()` checks Claude responses for PII leakage and model refusal patterns

**Residual risk:** Regex-based detection cannot catch novel or obfuscated injection techniques. Sophisticated adversarial prompts may bypass pattern matching.

---

*Version: v3 Final | Date: 2026-04-12*
