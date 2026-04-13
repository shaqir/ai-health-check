# Maintenance Runbook

> ARTI-409-A | AIHealthCheck | Final

Operational playbook for common scenarios. Follow these procedures when alerts trigger or errors are observed.

---

## S1: High Latency

**Trigger:** Average latency > 2000 ms for a service on the dashboard, or P95/P99 latency spikes visible on the Performance page.

**Investigation:**
1. Open the service in the registry and click Test Connection.
2. If the test also shows high latency, check P50/P95/P99 percentiles on the Performance page to understand the distribution.
3. Check Anthropic's status page for known outages.
4. If only one service is affected, verify the service's model name and endpoint configuration.
5. Review `api_usage_log` for recent `error_timeout` entries.

**Resolution:**
1. If Anthropic is experiencing degradation, wait for recovery. The retry logic (2 retries with exponential backoff) handles transient failures automatically.
2. If latency is isolated to one service, check its configuration.
3. If latency exceeds 10 seconds, consider setting the service to inactive temporarily.
4. Create an incident with severity medium and run the troubleshooting checklist.

**Prevention:** APScheduler health checks run on a recurring interval. Monitor the dashboard P95 and P99 trends to catch gradual degradation early.

---

## S2: Quality Score Drop

**Trigger:** Evaluation harness reports quality_score < 75% and drift_flagged = true. The drift-check endpoint returns drift_severity "warning" or "critical".

**Investigation:**
1. Review the eval run details on the dashboard. Check the per-test-case breakdown to identify which tests failed (factuality or format_json).
2. Query the drift-check endpoint for the service: examine drift_severity, trend_direction, score_variance, and confidence level.
3. Re-run the evaluation manually to confirm it is not transient.

**Resolution:**
1. If confirmed, create an incident with severity high.
2. Run the troubleshooting checklist:
   - Data issue -- check if test cases have changed.
   - Prompt change -- check if system prompts were modified (see PROMPT_CHANGE_LOG.md).
   - Model update -- check if Anthropic updated the model version (current: claude-sonnet-4-6-20250415).
   - Infrastructure -- check connection health and retry counts in api_usage_log.
   - Safety/policy -- check if the model is refusing test prompts (scan_output detects model_refusal).
3. Review per-test trend data: if factuality scores declined, score_factuality may need prompt tuning. If format_json scores declined, the model may have changed its JSON output behavior.
4. Use Generate Summary to draft a stakeholder update (review before approving).

**Prevention:** Monitor trend_direction. A "declining" trend with confidence "high" warrants investigation even if the score has not yet crossed the 75% threshold.

**Escalation:** If quality score is below 50%, escalate to severity critical. If drift_severity is "critical" with a sudden drop > 15 points from the previous average, escalate immediately.

---

## S3: PII Detected

**Trigger:** The output safety scanner flags `output_pii_ssn` or `output_pii_credit_card` in a response, or manual review reveals PII. The api-safety dashboard endpoint shows flagged calls.

**Investigation:**
1. Identify exactly what PII was found and in which response.
2. Check the service's sensitivity_label -- if it is confidential, this is a data handling failure.
3. Review the prompt sent to the LLM in `api_usage_log` (check caller function and safety_flags).
4. Check PII detection patterns in `safety.py` (email, phone, SSN, credit_card).

**Resolution:**
1. Create an incident with severity critical immediately.
2. Do NOT approve the LLM summary -- reject the draft.
3. Update the Privacy Routing page if the data handling explanation needs clarification.
4. Consider switching the affected service to a local LLM via the llm_client.py wrapper.

**Prevention:** Ensure services with confidential sensitivity labels have prompts reviewed before use. The safety scanner catches common PII patterns but cannot detect all formats.

**Escalation:** Notify the team lead immediately. Document in the audit log.

---

## S4: LLM Provider Down

**Trigger:** Test Connection returns status "failure". The retry logic in llm_client.py has exhausted all 2 retries with exponential backoff.

**Investigation:**
1. Confirm by testing connection on multiple services.
2. Check Anthropic's status page.
3. Review `api_usage_log` for error categories: `error_timeout` (connection issues), `error_server` (Anthropic 5xx), `error_auth` (API key issues).
4. Check retry entries (`retry_0`, `retry_1`) to see if retries are being attempted.

**Resolution:**
1. The incident triage workflow still works without the LLM -- create incidents, fill checklists, and write maintenance plans manually.
2. Only generate_summary, generate_dashboard_insight, and generate_compliance_summary require the API.
3. If outage persists beyond 2 hours, create an incident documenting the outage and impact.

**Prevention:** The application is designed to degrade gracefully. No feature crashes or shows a blank screen when the LLM is unavailable. The test_connection function catches all exceptions and returns a descriptive error in the response_snippet field.

---

## S5: Unauthorized Access Attempt

**Trigger:** Audit log shows a Viewer role attempted an Admin or Maintainer action.

**Investigation:**
1. Verify in the audit log that the RBAC middleware blocked the action (HTTP 403).
2. Confirm the action was NOT executed.
3. If the action was executed despite RBAC, this is a critical security bug.

**Resolution:**
1. Check the route handler to confirm it has the `require_role()` dependency.
2. Document the finding and add a test case to prevent regression.

**Prevention:** JWT tokens use HS256 with 480-minute expiry. RBAC roles (admin, maintainer, viewer) are enforced at the route level. Passwords are hashed with bcrypt.

---

## S6: API Budget Exceeded

**Trigger:** A user receives HTTP 402 with a BudgetExceededError message. The dashboard api-usage endpoint shows budget_pct_used at 100%.

**Investigation:**
1. Check the api-usage endpoint for current spending: daily cost vs. $5.00 limit, monthly cost vs. $25.00 limit.
2. Review the per-function cost breakdown to identify which function consumed the most budget (test_connection, run_eval_prompt, score_factuality, generate_summary, generate_dashboard_insight, generate_compliance_summary).
3. Check whether automated scheduled evaluations are running too frequently.

**Resolution:**
1. To increase daily budget: update `API_DAILY_BUDGET` in `.env` (default: 5.0).
2. To increase monthly budget: update `API_MONTHLY_BUDGET` in `.env` (default: 25.0).
3. If the budget should not be increased, wait for the next period (daily resets at midnight UTC, monthly resets on the 1st).
4. Consider reducing evaluation frequency or limiting test cases per service.

**Prevention:** Use the cost-preview endpoint (`/evaluations/cost-preview/{service_id}`) before running large evaluation batches. Cost estimation uses Claude Sonnet 4.6 pricing: $3.00/M input tokens, $15.00/M output tokens.

---

## S7: User Rate Limited

**Trigger:** A user receives HTTP 429 with a BudgetExceededError message indicating rate limit exceeded.

**Investigation:**
1. Determine whether the limit hit is global (10 calls/min across all users) or per-user (5 calls/min per individual).
2. Review `api_usage_log` for the past minute to see which callers are consuming API calls.

**Resolution:**
1. If a single user is making excessive requests, advise them to space out operations.
2. If automated processes are hitting the global limit, check APScheduler intervals and ensure scheduled jobs are not overlapping.
3. To adjust limits in `.env`:
   - `API_MAX_CALLS_PER_MINUTE` (default: 10) for the global limit.
   - `API_MAX_CALLS_PER_USER_PER_MINUTE` (default: 5) for the per-user limit.
4. The rate limit resets automatically after one minute -- no manual intervention needed for transient spikes.

**Prevention:** Both successful calls and errors count toward the rate limit. Rate limit checks query `api_usage_log` for calls within the last 60 seconds.

---

## S8: Prompt Injection Detected

**Trigger:** A user receives HTTP 422 with a PromptSafetyError message. The api-safety endpoint shows blocked calls with status "blocked_safety".

**Investigation:**
1. Check the api-safety endpoint for recent blocked calls: review safety_flags and risk_score.
2. Determine whether the block was a true positive or false positive:
   - True positive: prompt contained injection patterns (e.g., "ignore previous instructions", "jailbreak", "DAN mode"). No action needed beyond logging.
   - False positive: legitimate prompt matched an injection regex. Document the false positive.

**Resolution (false positive):**
1. Review the specific regex pattern in `safety.py` (`_INJECTION_PATTERNS` list).
2. Consider making the pattern more specific. Do NOT remove a pattern entirely without assessing the security trade-off.

**Resolution (true positive):**
1. Check user_id in `api_usage_log` to identify who submitted the injection attempt.
2. Review whether the user has a pattern of attempts.
3. Consider whether this warrants a security incident.

**Prevention:** Risk scoring weights: 40 per injection match, 20 per PII type, 15 for length warning (> 80% of 10,000 char max). Block threshold: risk >= 80. The scanner runs on input (before Claude) and output (after Claude). Input blocking prevents the prompt from reaching the API. Output scanning flags responses but only blocks those containing SSNs or credit card numbers.

---

## S9: Login Brute-Force Detected

**Trigger:** A user receives HTTP 429 with message "Too many failed login attempts. Try again in 15 minutes." The `login_attempts` table shows 5+ failed attempts for the same email within 15 minutes.

**Investigation:**
1. Query `login_attempts` for the affected email: check count of failed attempts, IP addresses, and timestamps.
2. Determine intent:
   - Legitimate user: multiple attempts from the same IP with slight password variations. Advise them to wait 15 minutes.
   - Suspected attack: attempts from multiple IPs, or targeting multiple email addresses.

**Resolution (suspected attack):**
1. Create an incident with severity high.
2. Document the IP addresses and email addresses targeted.
3. Consider blocking IPs at the network level (outside the application).
4. Review audit logs for other suspicious activity from those IPs.

**Resolution (legitimate user):**
1. The lockout is automatic and resets after 15 minutes (configurable via `LOGIN_LOCKOUT_MINUTES`).
2. Maximum failed attempts configurable via `MAX_LOGIN_ATTEMPTS` (default: 5).
3. There is no admin override to unlock early -- the lockout expires automatically.

**Prevention:** The throttle check runs before password verification to prevent timing attacks. Both successful and failed attempts are recorded for auditing. Only email-based throttling is implemented; there is no IP-based rate limiting at the application level.

---

## General Maintenance Schedule

| Task | Frequency | Owner |
|------|-----------|-------|
| Run evaluation harness | Configurable (default: every 60 min via APScheduler) | Automated |
| Health check all services | Recurring via APScheduler | Automated |
| Review audit log for anomalies | Weekly | Admin |
| Review api_usage_log for cost trends | Weekly | Admin |
| Review api-safety metrics for injection attempts | Weekly | Admin |
| Check budget utilization vs. limits | Daily | Admin |
| Export compliance evidence | Monthly or as needed | Admin |
| Review and update test cases | Bi-weekly | Maintainer |

---

*Version: Final | Date: 2026-04-12*
