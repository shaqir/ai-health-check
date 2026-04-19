# Prompt and Change Log

> Last updated: 2026-04-18 · current as of commit `3396e21`
>
> Canonical source for LLM usage and prompt templates. For risk mitigations referencing these functions, see [RISK_REGISTER.md](RISK_REGISTER.md). For evaluation scoring details, see [EVAL_DATASET_CARD.md](EVAL_DATASET_CARD.md).

---

## 1. Model History

| Date | Change | Reason |
|------|--------|--------|
| 2026-03-18 | Initial: `claude-sonnet-4-20250514` (Sonnet 4), `anthropic>=0.39.0` | Project launch |
| 2026-04-12 | Upgrade: `claude-sonnet-4-6-20250415` (Sonnet 4.6), `anthropic>=0.49.0` | Improved reasoning and instruction following; no prompt changes required |
| 2026-04-18 | Judge parser strict mode: `score_factuality()` and `detect_hallucination()` now require `re.fullmatch` on a bare integer and return `None` on refusal | Hostile QA found the old `re.search(r"\d+", text)` misread refusals ("I cannot rate this. 404 Not Found" → 404 → clamp 100 → severe hallucination; "I can give you 7 reasons" → factuality 7% → false drift). No prompt text changed; parsing contract changed. |

---

## 2. LLM Functions

All functions are in `backend/app/services/llm_client.py`. No route handler touches the Anthropic SDK directly.

---

### test_connection

Module 1 (Service Registry). Verifies API connectivity and measures latency. Max tokens: 50.

```
Say hello in exactly 5 words.
```

Output: Returns `{status, latency_ms, response_snippet}` (first 200 chars). On exception, returns failure with error message.

---

### run_eval_prompt

Module 2 (Evaluation Harness). Sends eval test case prompt for scoring. Max tokens: `LLM_MAX_TOKENS` (default 1024).

```
[EvalTestCase.prompt sent as-is, no wrapping or modification]
```

Output: Returns `{response_text, latency_ms}`. On error, response_text is `"ERROR: {message}"`. Scored by `score_factuality` (factuality category) or `json.loads()` (format_json category).

---

### score_factuality

Module 2 (Evaluation Scoring). Rates factual similarity 0-100. Max tokens: 10.

```
You are evaluating AI output quality. Compare the expected output with the actual output and rate their factual similarity on a scale of 0-100.

Expected output:
{expected}

Actual output:
{actual}

Respond with ONLY a single integer from 0 to 100. No other text.
```

Output: Parsed via `_parse_judge_score()` using `re.fullmatch` on the whole response — ONLY a bare integer (with optional whitespace / fractional suffix) counts. Any refusal or prose response returns `None`. Callers treat `None` as `judge_refused` and exclude from aggregates so a misbehaving judge doesn't spuriously trip drift.

---

### generate_summary

Module 3 (Incident Triage). Generates stakeholder update and root cause analysis. Max tokens: `LLM_MAX_TOKENS` (default 1024).

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

Output: Split on `"ROOT CAUSES:"` to separate `summary_draft` from `root_causes_draft`. `STAKEHOLDER UPDATE:` prefix stripped. Stored in draft until human approval.

---

### generate_dashboard_insight

Module 2 (Dashboard AI Summary). Summarizes platform health with action items. Max tokens: `LLM_MAX_TOKENS` (default 1024).

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

Output: Full response returned as `insight_text`. On error, error message becomes insight_text.

---

### generate_compliance_summary

Module 4 (Compliance AI Report). Generates compliance report from audit/incident/drift data. Max tokens: `LLM_MAX_TOKENS` (default 1024).

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

Output: Full response returned as `report_text`. Input serialized via `json.dumps(default=str)`. Capped at 20 audit entries, 10 incidents, 10 drift events. Empty lists replaced with placeholder text.

---

### detect_hallucination

Module 2 (Hallucination Detection). Judges whether a model response contains unsupported or fabricated claims. Inspired by Patronus AI / Braintrust. Max tokens: 10.

```
You are a hallucination detector. Given a prompt and a model's response, rate how much the response contains unsupported or fabricated claims.

PROMPT:
{prompt}

RESPONSE:
{response_text}

Score from 0 to 100:
- 0 = fully grounded, no hallucination
- 50 = some claims not directly supported by the prompt
- 100 = mostly fabricated or contradicts the prompt

Respond with ONLY a single integer from 0 to 100. No other text.
```

Output: Parsed via `_parse_judge_score()` — same strict contract as `score_factuality`. `None` on refusal; callers exclude refused results from the hallucination aggregate. Score stored in `EvalRun.hallucination_score`.

---

## 3. Centralized Pipeline

All seven functions route through `_make_api_call()` in `llm_client.py`:

1. **Input safety scan** -- `scan_input()` checks injection patterns, PII, and prompt length; blocks unsafe prompts (HTTP 422)
2. **Atomic check + reserve** -- `_check_budget()` and a reservation INSERT happen under `_BUDGET_LOCK` so concurrent callers cannot all race past the limit. Checks daily/monthly budgets, global rate limit, and per-user rate limit. Raises HTTP 402 on budget, HTTP 429 on rate limit
3. **Retry with backoff** -- `2^attempt + random(0, 0.5)` sec, max 2 retries for transient errors (timeouts, 429, 5xx); non-retryable errors fail immediately. API call runs OUTSIDE the budget lock so slow requests don't block other evaluators
4. **Output safety scan** -- `scan_output()` checks response for PII and refusal patterns
5. **Finalize reservation** -- update the reserved row with real tokens, cost, latency, and status (success / error_timeout / error_rate_limit / error_server / error_auth / error_bad_request / error_unknown)

Sensitivity gate: when an LLM call is tied to a specific service (eval run, incident summary, test-connection in LLM mode), `services/sensitivity.py::enforce_sensitivity()` runs BEFORE `_make_api_call`. Confidential services require admin role AND an explicit `allow_confidential=true` override. Every attempt is audited.
