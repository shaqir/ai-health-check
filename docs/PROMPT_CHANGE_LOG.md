# Prompt and Change Log

> ARTI-409-A | AIHealthCheck | Final
>
> This document is an AI tool usage governance artifact. It tracks all Claude API prompt templates used in the application and documents the model upgrade history.

---

## Model History

| Date | Change | Model ID | SDK Requirement |
|------|--------|----------|-----------------|
| 2026-03-18 | Initial implementation | `claude-sonnet-4-20250514` (Sonnet 4) | `anthropic>=0.39.0` |
| 2026-04-12 | Model upgrade | `claude-sonnet-4-6-20250415` (Sonnet 4.6) | `anthropic>=0.49.0` |

**Reason for upgrade:** Sonnet 4.6 offers improved reasoning and instruction following. Pricing: $3.00 per million input tokens, $15.00 per million output tokens. Configuration via `LLM_MODEL` in `.env`, with defaults in `app/config.py`. No prompt changes were required for the upgrade.

---

## AI-Assisted Code Generation

### 2026-03-18 -- Initial Project Scaffold

- **Prompt used:** "Help me set up the project structure for our AIHealthCheck with React + FastAPI + SQLite"
- **Tool:** Claude (via Claude.ai)
- **What changed:** Created full project directory structure, backend (FastAPI + SQLAlchemy models + auth + RBAC + LLM wrapper), frontend (React + Vite + Tailwind + routing + auth context), config files, and documentation templates.
- **How verified:** Manual review of all generated files by team. Structure matches architecture diagram from project plan.

---

## Claude API Prompt Templates

All LLM calls go through `backend/app/services/llm_client.py`. No route handler touches the Anthropic SDK directly. Below are all six functions with their exact prompt templates.

---

### Function 1: test_connection

- **Module:** Module 1 (Service Registry)
- **Purpose:** Sends a small prompt to Claude and measures latency to verify API connectivity.
- **Caller string:** `test_connection`
- **Max tokens:** 50

**Prompt (default):**

```
Say hello in exactly 5 words.
```

**Parameters:** The prompt is configurable via the function parameter. No system message is used.

**Output parsing:** Returns status (success/failure), latency_ms, and response_snippet (first 200 characters). On any exception, returns failure status with the error message as the snippet.

**Verification:** Manual testing via the Test Connection button in the service registry UI.

---

### Function 2: run_eval_prompt

- **Module:** Module 2 (Evaluation Harness)
- **Purpose:** Sends an eval test case prompt and returns the raw response for scoring.
- **Caller string:** `run_eval_prompt`
- **Max tokens:** Configured via `LLM_MAX_TOKENS` (default: 1024)

**Prompt:**

```
[EvalTestCase.prompt is sent as-is, with no wrapping or modification]
```

**Parameters:** Optional `system_context` parameter passed as the `system` kwarg to the API call. Currently not used by the evaluation router.

**Output parsing:** Returns response_text and latency_ms. On error, returns `"ERROR: {error message}"` as the response text with latency 0. The response is then scored by either `score_factuality` (for factuality category) or `json.loads()` (for format_json category).

**Verification:** Evaluation harness runs with synthetic test cases; scores compared against expected outputs.

---

### Function 3: score_factuality

- **Module:** Module 2 (Evaluation Scoring)
- **Purpose:** Asks Claude to rate factual similarity between expected and actual output on a 0-100 scale.
- **Caller string:** `score_factuality`
- **Max tokens:** 10

**Prompt template:**

```
You are evaluating AI output quality. Compare the expected output with the actual output and rate their factual similarity on a scale of 0-100.

Expected output:
{expected}

Actual output:
{actual}

Respond with ONLY a single integer from 0 to 100. No other text.
```

**Output parsing:** Response parsed via regex (`\d+`) to extract the first integer. Score clamped to 0-100 with `min(max(score, 0), 100)`. On any exception, returns 0.0.

**Verification:** Tested with known-good pairs (e.g., "The capital of France is Paris" vs. actual Claude response to "What is the capital of France?"). Scores consistently return 85-100 for correct answers.

---

### Function 4: generate_summary

- **Module:** Module 3 (Incident Triage)
- **Purpose:** Generates a stakeholder update and root cause analysis for an incident.
- **Caller string:** `generate_summary`
- **Max tokens:** Configured via `LLM_MAX_TOKENS` (default: 1024)

**Prompt template:**

```
You are an AI operations assistant. An incident has been reported.

Service: {service_name}
Severity: {severity}
Symptoms: {symptoms}

Troubleshooting checklist results:
- Data Issue: Yes/No
- Prompt Change: Yes/No
- Model Update: Yes/No
- Infrastructure: Yes/No
- Safety/Policy: Yes/No

Please provide:
1. A brief stakeholder update (2-3 sentences suitable for management)
2. Top 3 most likely root causes based on the symptoms and checklist

Format your response as:
STAKEHOLDER UPDATE:
[your update here]

ROOT CAUSES:
1. [cause 1]
2. [cause 2]
3. [cause 3]
```

**Parameters:** `checklist` dict is formatted dynamically using `"Yes" if v else "No"` for each key.

**Output parsing:** Response split on `"ROOT CAUSES:"` to separate stakeholder update from root causes. The `STAKEHOLDER UPDATE:` prefix is stripped from summary_draft. On error, the error message becomes the summary_draft.

**Verification:** Manual review via the human-in-the-loop approval flow. Output stored in summary_draft until explicitly approved.

---

### Function 5: generate_dashboard_insight

- **Module:** Module 2 (Dashboard AI Summary)
- **Purpose:** Summarizes current platform health and suggests action items.
- **Caller string:** `generate_dashboard_insight`
- **Max tokens:** Configured via `LLM_MAX_TOKENS` (default: 1024)

**Prompt template:**

```
You are an AI operations analyst. Summarize the current platform health based on these metrics and suggest 2-3 action items.

Platform Metrics:
- Active Services: {active_services}
- Average Latency: {avg_latency_ms:.1f} ms
- Error Rate: {error_rate_pct:.1f}%
- Average Quality Score: {avg_quality_score:.1f}%
- Drift Alerts: {drift_alert_count}

Provide a concise summary (3-4 sentences) followed by action items.

Format as:
SUMMARY:
[your summary]

ACTION ITEMS:
1. [item 1]
2. [item 2]
3. [item 3]
```

**Parameters:** Metrics aggregated from the database: active services (is_active=True), average latency (last 24 hours of connection logs), error rate (last 7 days), quality score (average of last 10 eval runs), drift alert count (drift-flagged runs in last 7 days).

**Output parsing:** Returns the full response as insight_text. On error, the error message becomes the insight_text.

**Verification:** Manual review on the dashboard. Verified that metrics are accurately reflected in the generated narrative.

---

### Function 6: generate_compliance_summary

- **Module:** Module 4 (Compliance AI Report)
- **Purpose:** Generates a professional compliance report from audit, incident, and drift data.
- **Caller string:** `generate_compliance_summary`
- **Max tokens:** Configured via `LLM_MAX_TOKENS` (default: 1024)

**Prompt template:**

```
You are an AI governance compliance officer. Generate a concise compliance report based on the following data from the AI operations platform.

AUDIT LOG ENTRIES (recent):
{audit_summary}

INCIDENTS (recent):
{incidents_summary}

DRIFT EVENTS (recent):
{drift_summary}

Write a professional compliance report with these sections:
1. Executive Summary (2-3 sentences)
2. Key Findings (bullet points)
3. Risk Assessment (any concerns)
4. Recommendations (actionable items)

Keep the report under 500 words.
```

**Parameters:** Input data serialized via `json.dumps` with `default=str` for datetime serialization. Audit data capped at 20 entries, incidents at 10, drift data at 10. Empty lists replaced with placeholder text ("No audit logs." / "No incidents." / "No drift events.").

**Output parsing:** Returns the full response as report_text. On error, the error message becomes the report_text.

**Verification:** Manual review of generated reports against the input data. Verified that all four sections are consistently produced.

---

## Centralized API Call Infrastructure

All six functions above route through `_make_api_call` in `llm_client.py`, which enforces the following pipeline on every call:

1. **Input safety scan** -- `scan_input()` from `safety.py` checks for injection patterns (15 regex), PII (email, phone, SSN, credit card), and prompt length (max 10,000 characters). Blocked prompts raise `PromptSafetyError` (HTTP 422) with flags and risk score.

2. **Budget check** -- `_check_budget()` verifies daily ($5) and monthly ($25) budget limits against `api_usage_log` totals. Raises `BudgetExceededError` (HTTP 402) when exceeded.

3. **Rate limit check** -- Same `_check_budget()` function checks global rate limit (10 calls/min) and per-user rate limit (5 calls/min) against `api_usage_log` entries in the last 60 seconds. Raises `BudgetExceededError` (HTTP 429) when exceeded.

4. **Retry with backoff** -- Exponential backoff (`2^attempt + random(0, 0.5)` seconds) with max 2 retries for `RateLimitError`, `APIConnectionError`, and `InternalServerError`. Non-retryable errors (`AuthenticationError`, `BadRequestError`) fail immediately.

5. **API call** -- `client.messages.create()` with the configured model, max_tokens, messages, and timeout.

6. **Output safety scan** -- `scan_output()` checks the Claude response for PII leakage and model refusal patterns. Flags are appended to the safety record.

7. **Usage logging** -- Every call (success, error, retry, blocked) is recorded in the `api_usage_log` table with: caller, model, input_tokens, output_tokens, total_tokens, estimated_cost_usd, latency_ms, status, user_id, safety_flags, risk_score.

8. **Error categorization** -- Errors are classified as: `error_timeout`, `error_rate_limit`, `error_server`, `error_auth`, `error_bad_request`, `error_unknown`, `blocked_safety`. Retry attempts are logged as `retry_0`, `retry_1`.

---

*Version: Final | Date: 2026-04-12*
