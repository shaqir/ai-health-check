# Model Risk Register

> ARTI-409-A | AIHealthCheck
> v1 (Draft) — Phase 1 | Final — Phase 3

## Top 5 Risks & Mitigations

| # | Risk | Likelihood | Impact | Mitigation in Our Tool | Status |
|---|------|-----------|--------|----------------------|--------|
| 1 | **Data Privacy Breach** — sensitive data sent to cloud LLM | Medium | High | Sensitivity labels (public/internal/confidential) on every service; dedicated Privacy Routing page explaining what data leaves the server; LLM calls abstracted through REST wrapper for provider-swap capability | Implemented |
| 2 | **Model Drift** — quality degrades silently over time | High | High | Evaluation harness with scheduled runs via APScheduler; drift flag when quality score < 75% threshold; dashboard visibility with Recharts | Implemented |
| 3 | **Hallucination** — LLM generates inaccurate incident summaries | High | Medium | Human-in-the-loop: all LLM outputs require explicit "Approve" click before saving to DB; summary_draft field holds pending text until approved | Implemented |
| 4 | **Bias in AI Outputs** — biased root cause suggestions | Medium | Medium | Human review of all LLM suggestions; audit log records who approved what; policy adherence evaluation tests | Implemented |
| 5 | **Service Outage** — LLM provider goes down | Medium | Medium | Connection health checks via APScheduler; graceful error handling in llm_client.py; incident workflow still functions without LLM | Implemented |

## Risk Details

### Risk 1: Data Privacy Breach

**Scenario:** An operator registers a service with confidential data sensitivity but the system sends prompts containing sensitive information to the cloud LLM.

**Controls implemented:**
- Every service requires a `sensitivity_label` field (public / internal / confidential)
- The Privacy Routing page explains exactly what data leaves the server
- The LLM wrapper (llm_client.py) centralizes all outbound API calls — no route handler touches the SDK directly
- Audit log records every service registration and configuration change

**Residual risk:** If an operator manually includes sensitive data in incident symptom descriptions, that text could be sent to Claude when generating summaries. Mitigation: training + the Privacy Routing page warns users.

### Risk 2: Model Drift

**Scenario:** The Claude model is updated by Anthropic, and the quality of responses degrades without anyone noticing.

**Controls implemented:**
- Evaluation harness runs synthetic test cases and produces a quality score (0–100)
- Drift flag triggers automatically when score drops below configurable threshold (default 75%)
- Dashboard shows quality trends over time
- APScheduler can run evaluations on a recurring basis

### Risk 3: Hallucination

**Scenario:** When generating an incident summary, Claude invents plausible-sounding but incorrect root causes.

**Controls implemented:**
- LLM output is stored in `summary_draft` — a holding field
- The draft is displayed in the UI for human review
- Nothing is saved to the permanent `summary` field until the operator clicks "Approve"
- The `approved_by` field records which user approved the summary

### Risk 4: Bias in AI Outputs

**Scenario:** Claude consistently suggests certain root causes over others, or phrases recommendations in ways that reflect training data biases.

**Controls implemented:**
- Human reviews every LLM suggestion before it becomes part of the incident record
- Audit log captures who approved what and when
- Evaluation test cases include policy adherence checks

### Risk 5: Service Outage

**Scenario:** Anthropic's API goes down or rate limits are hit during a critical incident investigation.

**Controls implemented:**
- Test Connection button checks API availability before critical operations
- llm_client.py handles exceptions gracefully and returns descriptive error messages
- The incident workflow (create, triage, checklist) works fully without LLM — only summary generation requires the API
- APScheduler monitors connection health on an interval

---

*Updated: Phase 1 draft. Will be finalized in Phase 3 with actual test results.*
