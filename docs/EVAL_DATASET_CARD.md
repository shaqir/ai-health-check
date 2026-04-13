# Evaluation Dataset Card

> Canonical source for evaluation methodology and drift detection. For operational response to quality drops, see [MAINTENANCE_RUNBOOK.md](MAINTENANCE_RUNBOOK.md) S2.

---

## 1. Dataset

| ID | Service | Category | Prompt | Expected Output |
|----|---------|----------|--------|-----------------|
| F-01 | Service 1 | factuality | "What is the capital of France?" | "The capital of France is Paris." |
| J-01 | Service 1 | format_json | "Return a JSON object with keys 'name' and 'status' for a healthy service." | `{"name": "test", "status": "healthy"}` |
| F-02 | Service 2 | factuality | (service-specific factuality prompt) | (expected factual response) |
| J-02 | Service 2 | format_json | (service-specific JSON prompt) | (expected JSON structure) |
| F-03 | Service 3 | factuality | (service-specific factuality prompt) | (expected factual response) |
| J-03 | Service 3 | format_json | (service-specific JSON prompt) | (expected JSON structure) |

All data is synthetic. Stored in `eval_test_cases` table (SQLite). Model: `claude-sonnet-4-6-20250415`.

---

## 2. Scoring

### Factuality

Scored by `score_factuality()` in `llm_client.py` (prompt template in [PROMPT_CHANGE_LOG.md](PROMPT_CHANGE_LOG.md)).

- Claude rates factual similarity 0-100 (LLM-as-judge pattern)
- Response parsed via regex (`\d+`), clamped to 0-100
- On exception, defaults to 0.0

### Hallucination Detection

During factuality eval runs, `detect_hallucination()` in `llm_client.py` is called with the original prompt and the model's response (prompt template in [PROMPT_CHANGE_LOG.md](PROMPT_CHANGE_LOG.md)).

- Claude judges whether the response contains unsupported or fabricated claims, scoring 0-100 (0 = no hallucination, 100 = severe hallucination)
- Response parsed via regex (`\d+`), clamped to 0-100
- On exception, defaults to 0.0
- Score stored in `EvalRun.hallucination_score` and displayed in the eval runs table

### Format (JSON)

Binary scoring via `json.loads()`:

| Result | Score |
|--------|-------|
| Parse succeeds | 100.0 |
| `JSONDecodeError` or `TypeError` | 0.0 |

### Aggregates

| Metric | Formula |
|--------|---------|
| Quality Score | Mean of all individual test scores for a run |
| Factuality Score | Mean of factuality-category test scores only |
| Format Score | Mean of format_json-category test scores only |
| Drift Flag | True if quality score < 75% |

---

## 3. Per-Test Tracking

Each eval run stores one `EvalResult` row per test case in the `eval_results` table.

| Column | Type | Description |
|--------|------|-------------|
| id | Integer (PK) | Unique result identifier |
| eval_run_id | Integer (FK) | Links to parent EvalRun |
| test_case_id | Integer (FK) | Links to EvalTestCase |
| response_text | Text | Raw LLM response |
| score | Float | Individual test score (0-100) |
| latency_ms | Float | LLM call time in milliseconds |
| status | String | "success" or "error" (error if response starts with "ERROR:") |
| created_at | DateTime | Timestamp of result creation |

The drift-check endpoint aggregates historical `EvalResult` scores per test case across runs to compute per-test trends.

---

## 4. Drift Detection Algorithm

### Threshold

Default: **75%** (configurable via `DRIFT_THRESHOLD` env var). Score below threshold sets `drift_flagged = true`.

### Severity

| Severity | Criteria |
|----------|----------|
| none | Score >= threshold + 10 (i.e., >= 85%) AND trend is not declining |
| warning | Score within 10 points of threshold (75-85%) OR trend is declining |
| critical | Score < threshold (75%) OR sudden drop > 15 points from previous average |

Sudden drop: if >= 3 historical runs exist, compute average of all previous scores; if current score is >15 points below that average, escalate to critical.

### Trend (`_compute_trend`)

1. Collect quality scores from the most recent N runs (default 5, range 2-20)
2. Sort chronologically (oldest first)
3. Split into two halves at midpoint
4. Compute average of each half
5. Difference = second_half_avg - first_half_avg
6. Classify: > 3.0 = **improving**, < -3.0 = **declining**, else **stable**

If trend is "declining" AND score is within 10 points of threshold, `drift_flagged` is set to true even above the threshold.

### Variance (`_compute_variance`)

Population variance: `sum((score - mean)^2) / count`, rounded to 2 decimal places.

| Variance | Interpretation |
|----------|---------------|
| < 25 | Consistent; predictable behavior |
| 25-100 | Some fluctuation; may indicate intermittent issues |
| > 100 | Significant instability; investigate |

### Confidence

| Run Count | Level |
|-----------|-------|
| 1-2 | low |
| 3-4 | medium |
| 5+ | high |

---

## 5. Limitations

- Small dataset (2 test cases per service) -- sufficient for demonstration, not production-grade
- Factuality scoring uses LLM-as-judge (Claude evaluating its own output), which may have blind spots
- JSON format checks use `json.loads()` only -- no schema or key validation
- All test cases are English-only
- Variance and trend require multiple runs to be meaningful (confidence "low" with <3 runs)
