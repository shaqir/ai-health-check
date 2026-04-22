# Documentation Map

> All project documentation in one place. Pick the reading order that
> matches your role — each audience has a specific path.

---

## 🎓 If you're grading this project

Read in this order:

1. [TECHNICAL_REFERENCE](TECHNICAL_REFERENCE.md) — single consolidated reference manual covering all 14 documentation sections + presentation defence guide.
2. [ARCHITECTURE](ARCHITECTURE.md) — system design, 14 models, 9 routers, configuration reference.
3. [MODULE_GUIDE](MODULE_GUIDE.md) — M1-M4 module breakdown with owners, endpoints, demo flow.
4. [TESTING_STRATEGY](TESTING_STRATEGY.md) — 188 tests across 22 files with coverage policy.
5. [RISK_REGISTER](RISK_REGISTER.md) — 18 risks formally tracked with mitigations and residuals.
6. [SELF_CRITIQUE](SELF_CRITIQUE.md) — 8 methodological weaknesses the team identified in its own work.

Time budget: 45–60 minutes for a thorough pass. If you only have 20 min, read TECHNICAL_REFERENCE alone.

---

## 🛠 If you're setting this up

Read in this order:

1. [ONBOARDING](ONBOARDING.md) — setup steps, credentials, first-run walkthrough.
2. [TESTING_STRATEGY](TESTING_STRATEGY.md) — how to run tests and interpret coverage.
3. [ARCHITECTURE](ARCHITECTURE.md) §8 — configuration reference if `.env` needs tuning.

Time budget: 20 minutes to get running locally.

---

## 🏦 If you're a regulated-industry reviewer

Read in this order:

1. [GOVERNANCE_AUDIT](GOVERNANCE_AUDIT.md) — HIPAA / SOX / PCI-DSS / EU AI Act verdict with control-by-control breakdown.
2. [RISK_REGISTER](RISK_REGISTER.md) — formal risk register.
3. [SELF_CRITIQUE](SELF_CRITIQUE.md) — methodological gaps beyond the feature surface.
4. [MAINTENANCE_RUNBOOK](MAINTENANCE_RUNBOOK.md) — operational response procedures for 15 scenarios.

Time budget: 90 minutes. The governance audit alone is ~30 minutes.

---

## 🎤 If you're rehearsing a viva or live demo

Read in this order:

1. [LIVE_DEMO_WALKTHROUGH](LIVE_DEMO_WALKTHROUGH.md) — consolidated demo guide: night-before / morning-of / T-15 pre-flight / 9-step script with failure modes and killshot moments / recovery procedures / one-page checklist.
2. [VIVA_QA_PREP](VIVA_QA_PREP.md) — 10 hardest questions with ideal-answer phrasing.
3. [SELF_CRITIQUE](SELF_CRITIQUE.md) — honest-answer material for methodology probes.

Time budget: 30 minutes the night before, 10 minutes the morning of.

---

## 📚 Full index

| Doc | One-line summary |
|---|---|
| [TECHNICAL_REFERENCE](TECHNICAL_REFERENCE.md) | Consolidated reference manual (14 sections + presentation defence guide) |
| [ARCHITECTURE](ARCHITECTURE.md) | System design, models, routers, configuration reference |
| [MODULE_GUIDE](MODULE_GUIDE.md) | M1-M4 owners, files, endpoints, cross-cutting features, end-to-end demo flow |
| [ONBOARDING](ONBOARDING.md) | Setup steps and platform lifecycle walkthrough |
| [TESTING_STRATEGY](TESTING_STRATEGY.md) | 188 tests across 22 files, coverage floor, what's exercised |
| [EVAL_DATASET_CARD](EVAL_DATASET_CARD.md) | Test cases, scoring methodology, drift algorithm |
| [PROMPT_CHANGE_LOG](PROMPT_CHANGE_LOG.md) | All 7 LLM prompt templates, model history, parser changes |
| [MAINTENANCE_RUNBOOK](MAINTENANCE_RUNBOOK.md) | 15 operational scenarios with trigger / check / fix / prevent |
| [RISK_REGISTER](RISK_REGISTER.md) | 18 risks with mitigations and residual risk notes |
| [SELF_CRITIQUE](SELF_CRITIQUE.md) | 8 methodological weaknesses surfaced honestly |
| [GOVERNANCE_AUDIT](GOVERNANCE_AUDIT.md) | Enterprise compliance audit (HIPAA/SOX/EU AI Act) |
| [DOVER_MAPPING](DOVER_MAPPING.md) | Implementation mapping against the DOVER framework (Data / Oversight / Validation / Ethics / Risk) |
| [LIVE_DEMO_WALKTHROUGH](LIVE_DEMO_WALKTHROUGH.md) | Consolidated demo guide: prep, 9-step script, killshots, recovery, one-page checklist |
| [VIVA_QA_PREP](VIVA_QA_PREP.md) | 10 hardest Q&A questions with ideal-answer phrasing |

---

## 📅 Last updated

2026-04-18 — current as of commit `3396e21`
