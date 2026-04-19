# DOVER Framework — Implementation Mapping

> How AI Health Check maps to the 5 pillars of DOVER
> (Data, Oversight, Validation, Ethics, Risk).
>
> We did not frame the project around DOVER explicitly during
> construction, but the implementation covers all 5 pillars in substance.
> This document is the grab-and-go reference for viva questions like
> *"which framework does your project align with?"* — every claim below
> cites the exact file you can open on screen to defend it.

---

## Viva one-liner

> *"We didn't frame the project around DOVER explicitly, but the
> implementation maps cleanly to all five pillars. **Data** is sensitivity
> labels plus input/output PII scanning. **Oversight** is the shared
> `AILlmDraft` HITL contract with mandatory 20-character reviewer notes.
> **Validation** is LLM-as-judge with strict parsers that reject refusals,
> plus split-half drift detection. **Ethics** is the toxicity + injection
> safety pipeline and confidential-data gating. **Risk** is the 17-item
> register, the hash-chained audit log, budget/rate-limit concurrency
> safety, and the SSRF guard. I can point to the exact file for each."*

---

## D — Data

| DOVER expects | What we have | Where |
|---|---|---|
| Data classification | 3-level sensitivity labels (`public` / `internal` / `confidential`) per service | `backend/app/services/sensitivity.py`, `models/service.py` |
| PII controls | PII scanner (emails, phones, SSNs) on both **input and output** of every LLM call | `services/safety.py::scan_input` / `scan_output` |
| Dataset governance | Versioned eval test cases with expected answers + documentation | `models/eval.py` + `docs/EVAL_DATASET_CARD.md` |
| Input/output boundary | Every LLM call goes through the 6-stage pipeline; nothing bypasses | `services/llm_client.py::_make_api_call` |

---

## O — Oversight

| DOVER expects | What we have | Where |
|---|---|---|
| Human-in-the-loop | Shared `AILlmDraft` + `draft_service` abstraction used by incidents, dashboard insights, and compliance reports | `services/draft_service.py` |
| Reviewer accountability | Mandatory ≥20-char reviewer note, live-validated in UI + re-checked on server, length logged to audit | `routers/incidents.py::approve_summary` + `ReviewerNoteModal.jsx` |
| RBAC | 3 roles (admin / maintainer / viewer); every denial audited as `role_denied` | `middleware/rbac.py` |
| Idempotent approvals | Double-approve returns 409; attribution preserved | test `test_approve_is_idempotent_409_on_second_call` |
| Operator surface | Dashboard control-room, command palette (⌘K), drift banner | `pages/DashboardPage.jsx` |

---

## V — Validation

| DOVER expects | What we have | Where |
|---|---|---|
| Quality scoring | LLM-as-judge for factuality; strict `re.fullmatch(r"\d{1,3}")` parser returns `None` on judge refusal | `services/llm_client.py::score_factuality` |
| Format validation | JSON schema checks on eval outputs | `routers/evaluations.py` |
| Drift detection | Threshold (75%) + split-half trend + variance + severity | `routers/dashboard.py::_compute_trend` |
| Hallucination detection | 0–100 judge score with the same strict parser | `services/llm_client.py::score_hallucination` |
| Test suite | 123 pytest tests, 71% coverage, 65% CI floor | `backend/tests/`, `pytest.ini` |
| Pre-deployment probe | Test-connection endpoint with SSRF guard + latency logging | `routers/services.py::test_connection` |

---

## E — Ethics

| DOVER expects | What we have | Where |
|---|---|---|
| Toxicity guard | Category-based checks (violence / bias / illegal / self-harm) on every input | `services/safety.py::scan_toxicity` |
| Prompt-injection defence | 15 injection patterns + length caps | `services/safety.py::scan_injection` |
| Bias screening (output) | Part of toxicity pipeline; flagged outputs block the response | `services/safety.py` |
| Confidential-data protection | Confidential services require explicit admin override + audit trail to reach the LLM | `services/sensitivity.py::enforce_sensitivity` |

---

## R — Risk

| DOVER expects | What we have | Where |
|---|---|---|
| Risk register | 17 risks formally tracked with mitigation + residual | `docs/RISK_REGISTER.md` |
| Budget controls | Daily + monthly caps, concurrency-safe via `_BUDGET_LOCK` + reservation INSERT | `services/llm_client.py::_reserve_and_check_budget` |
| Rate limits | Per-user (5/min) + global (10/min), race-safe | `services/llm_client.py::_reserve_and_check_rate_limit` |
| SSRF defence | RFC1918 + link-local + cloud-metadata blocking on every outbound URL | `services/url_validator.py` |
| Tamper-evident audit | SHA-256 hash chain + SQLite BEFORE UPDATE/DELETE triggers + admin-only verify | `models/audit.py`, `middleware/audit.py`, `routers/compliance.py::verify_integrity` |
| Incident management | Severity-tagged lifecycle with 5-point triage checklist | `routers/incidents.py` |
| Change control | Maintenance plans with risk level, rollback, validation steps, human approval | `routers/maintenance.py` |
| Auth hardening | bcrypt, JWT HS256, login throttling (5 failed attempts → 15-min lockout) | `middleware/auth.py`, `routers/auth.py` |
| Compliance export | PDF + JSON with truncation warnings surfaced loudly | `routers/compliance.py::export` |

---

## Honest gaps to acknowledge

The mapping above is strong, but a strict reviewer will probe two areas.
Don't oversell — own these:

### 1. Fairness testing (Ethics pillar)

**Gap:** No disparate-impact harness against a demographic-stratified
dataset. Bias detection is heuristic (keyword-based + LLM-judged on free
text), not statistical across protected attributes.

**Honest-answer phrasing:** *"Fairness testing is the gap. We detect bias at
the output-scanning layer heuristically, but we do not run a
disparate-impact harness against a demographic-stratified dataset. In
production this would mean a held-out eval set stratified by protected
attributes with a delta threshold that blocks promotion if any slice's
quality diverges beyond ε. That's a planned addition, not a shipped
feature."*

### 2. Independent audit-log anchoring (Risk pillar)

**Gap:** The SHA-256 hash chain detects tampering but is not anchored to an
external system (WORM storage / blockchain / regulated vault). A privileged
host-level actor could rebuild the chain.

**Honest-answer phrasing:** *"In-app adversary, yes — we detect it. Privileged
host actor, no. Production would anchor the chain root to an external
append-only store on a schedule. Documented as R9 residual."*

---

## For deeper reading

- [`docs/ARCHITECTURE.md`](ARCHITECTURE.md) — system design, models, routers
- [`docs/RISK_REGISTER.md`](RISK_REGISTER.md) — all 17 risks with residuals
- [`docs/GOVERNANCE_AUDIT.md`](GOVERNANCE_AUDIT.md) — HIPAA / SOX / EU AI Act posture
- [`docs/SELF_CRITIQUE.md`](SELF_CRITIQUE.md) — methodological gaps beyond the feature surface
- [`docs/EVAL_DATASET_CARD.md`](EVAL_DATASET_CARD.md) — dataset + scoring methodology
