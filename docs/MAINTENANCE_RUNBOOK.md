# Maintenance Runbook

> Canonical source for operational procedures. For risk definitions, see [RISK_REGISTER.md](RISK_REGISTER.md). For drift algorithm details, see [EVAL_DATASET_CARD.md](EVAL_DATASET_CARD.md).

---

### S1: High Latency

**Trigger:** Average latency > 2000 ms or P95/P99 spike on the Performance page.

**Check:** Test Connection on the affected service | Review `api_usage_log` for `error_timeout` entries | Check Anthropic status page.

**Fix:** If Anthropic-wide, wait for recovery (retry logic handles transient failures) | If isolated to one service, verify model name and endpoint config | If >10s, set service to inactive temporarily.

**Prevent:** Monitor dashboard P95/P99 trends; APScheduler health checks run on a recurring interval.

---

### S2: Quality Drop

**Trigger:** drift-check endpoint returns `drift_severity` "warning" or "critical".

**Check:** Per-test-case breakdown on dashboard (identify failing factuality vs format_json tests) | Query drift-check endpoint for severity, trend, variance, confidence | Re-run evaluation to confirm.

**Fix:** Create incident with severity high | Run troubleshooting checklist (data issue, prompt change per [PROMPT_CHANGE_LOG.md](PROMPT_CHANGE_LOG.md), model update, infrastructure, safety/policy) | Review per-test trends to determine if factuality or format scoring degraded.

**Prevent:** Investigate when `trend_direction` is "declining" with "high" confidence, even above threshold. An alert is auto-created in the Alert system when drift is detected; review and acknowledge alerts via `GET /alerts` and `POST /alerts/{id}/acknowledge`.

---

### S3: PII Detected

**Trigger:** Output scanner flags `output_pii_ssn` or `output_pii_credit_card`, or manual review reveals PII.

**Check:** Identify what PII was found and in which response | Check the service's `sensitivity_label` | Review `api_usage_log` for `safety_flags`.

**Fix:** Create incident with severity critical | Reject the LLM summary draft (do NOT approve) | Review prompt content that triggered the PII leak.

**Prevent:** Review prompts for services with confidential sensitivity labels before use.

---

### S4: LLM Down

**Trigger:** Test Connection returns "failure" after exhausting 2 retries.

**Check:** Test connection on multiple services | Check Anthropic status page | Review `api_usage_log` for `error_timeout`, `error_server`, `error_auth` and retry entries (`retry_0`, `retry_1`).

**Fix:** Use incident workflow without LLM (create incidents, fill checklists, write plans manually) | If outage >2h, create incident documenting impact.

**Prevent:** Application degrades gracefully; no feature crashes when LLM is unavailable.

---

### S5: Unauthorized Access

**Trigger:** Audit log shows a Viewer role attempted an Admin or Maintainer action.

**Check:** Verify RBAC middleware blocked the action (HTTP 403) | Confirm the action was NOT executed.

**Fix:** Check that the route handler has the `require_role()` dependency | Add a regression test case.

**Prevent:** JWT tokens use HS256 with 480-min expiry; RBAC roles enforced at the route level.

---

### S6: Budget Exceeded

**Trigger:** User receives HTTP 402 (`BudgetExceededError`); `budget_pct_used` at 100%.

**Check:** Query api-usage endpoint for daily cost vs $5 limit and monthly vs $25 limit | Review per-function cost breakdown | Check if scheduled evaluations are running too frequently.

**Fix:** Update `API_DAILY_BUDGET` or `API_MONTHLY_BUDGET` in `.env` | Or wait for next period (daily resets at midnight UTC, monthly on the 1st) | Reduce evaluation frequency.

**Prevent:** Use cost-preview endpoint (`/evaluations/cost-preview/{service_id}`) before large batches.

---

### S7: Rate Limited

**Trigger:** User receives HTTP 429 indicating rate limit exceeded.

**Check:** Determine if global (10 calls/min) or per-user (5 calls/min) | Review `api_usage_log` for the past minute.

**Fix:** Advise user to space out operations | Check APScheduler intervals for overlapping jobs | Adjust `API_MAX_CALLS_PER_MINUTE` or `API_MAX_CALLS_PER_USER_PER_MINUTE` in `.env`.

**Prevent:** Rate limit resets automatically after 60 seconds; both successes and errors count.

---

### S8: Injection Detected

**Trigger:** User receives HTTP 422 (`PromptSafetyError`); api-safety endpoint shows `blocked_safety` calls.

**Check:** Review safety_flags and risk_score on blocked calls | Determine true positive vs false positive.

**Fix (true positive):** Identify user via `user_id` in `api_usage_log`; assess if pattern warrants a security incident. **Fix (false positive):** Review the specific regex in `safety.py` `_INJECTION_PATTERNS`; make the pattern more specific without removing it.

**Prevent:** Risk scoring details and thresholds documented in [RISK_REGISTER.md](RISK_REGISTER.md) R8.

---

### S9: Brute-Force

**Trigger:** HTTP 429 with "Too many failed login attempts"; 5+ failures for same email within 15 minutes in `login_attempts`.

**Check:** Query `login_attempts` for affected email: count, IPs, timestamps | Distinguish legitimate user (same IP, slight password variations) from attack (multiple IPs or emails).

**Fix (attack):** Create incident with severity high; document IPs and emails; consider network-level IP blocking. **Fix (legitimate):** Lockout auto-resets after 15 minutes; no admin override available.

**Prevent:** Throttle check runs before password verification to prevent timing attacks.

---

## Maintenance Schedule

| Frequency | Task |
|-----------|------|
| Configurable (default 60 min) | Automated evaluation harness via APScheduler |
| Recurring via APScheduler | Health check all services |
| Weekly | Review audit log, api_usage_log costs, and api-safety metrics |
| Daily | Check budget utilization vs limits |
| Monthly | Export compliance evidence |
