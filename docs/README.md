# Documentation Map

> All project documentation in one place. Pick the reading order that
> matches your role — each audience has a specific path.

---

## 🎓 If you're grading this project

Read in this order:

1. [ARCHITECTURE](ARCHITECTURE.md) — system design, 14 models, 9 routers, configuration reference.
2. [MODULE_GUIDE](MODULE_GUIDE.md) — M1-M4 module breakdown with owners, endpoints, demo flow.
3. [TESTING_STRATEGY](TESTING_STRATEGY.md) — 123 tests across 13 files with coverage policy.
4. [RISK_REGISTER](RISK_REGISTER.md) — 17 risks formally tracked with mitigations and residuals.
5. [SELF_CRITIQUE](SELF_CRITIQUE.md) — 5 methodological weaknesses the team identified in its own work.

Time budget: 45–60 minutes for a thorough pass.

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

1. [LIVE_DEMO_WALKTHROUGH](LIVE_DEMO_WALKTHROUGH.md) — 9-step demo script with failure modes and killshot moments.
2. [DEMO_DAY_CHECKLIST](DEMO_DAY_CHECKLIST.md) — night-before / morning-of / T-15-min / recovery procedures.
3. [VIVA_QA_PREP](VIVA_QA_PREP.md) — 10 hardest questions with ideal-answer phrasing.
4. [SELF_CRITIQUE](SELF_CRITIQUE.md) — honest-answer material for methodology probes.
5. [FINAL_POLISH](FINAL_POLISH.md) — last-mile polish checklist if you have time before demo day.

Time budget: 30 minutes the night before, 10 minutes the morning of.

---

## 📚 Full index

| Doc | One-line summary |
|---|---|
| [ARCHITECTURE](ARCHITECTURE.md) | System design, models, routers, configuration reference |
| [MODULE_GUIDE](MODULE_GUIDE.md) | M1-M4 owners, files, endpoints, cross-cutting features, end-to-end demo flow |
| [ONBOARDING](ONBOARDING.md) | Setup steps and platform lifecycle walkthrough |
| [TESTING_STRATEGY](TESTING_STRATEGY.md) | 123 tests, coverage floor, what's exercised |
| [EVAL_DATASET_CARD](EVAL_DATASET_CARD.md) | Test cases, scoring methodology, drift algorithm |
| [PROMPT_CHANGE_LOG](PROMPT_CHANGE_LOG.md) | All 7 LLM prompt templates, model history, parser changes |
| [MAINTENANCE_RUNBOOK](MAINTENANCE_RUNBOOK.md) | 15 operational scenarios with trigger / check / fix / prevent |
| [RISK_REGISTER](RISK_REGISTER.md) | 17 risks with mitigations and residual risk notes |
| [ROADMAP](ROADMAP.md) | Sprint timeline and module ownership |
| [SELF_CRITIQUE](SELF_CRITIQUE.md) | 5 methodological weaknesses surfaced honestly |
| [GOVERNANCE_AUDIT](GOVERNANCE_AUDIT.md) | Enterprise compliance audit (HIPAA/SOX/EU AI Act) |
| [LIVE_DEMO_WALKTHROUGH](LIVE_DEMO_WALKTHROUGH.md) | 9-step demo rehearsal with failure modes and mitigations |
| [DEMO_DAY_CHECKLIST](DEMO_DAY_CHECKLIST.md) | Operational logistics for demo day: prep, recovery, one-page checklist |
| [VIVA_QA_PREP](VIVA_QA_PREP.md) | 10 hardest Q&A questions with ideal-answer phrasing |
| [FINAL_POLISH](FINAL_POLISH.md) | Near-final submission checklist (15 items across 5 categories) |

---

## 📅 Last updated

2026-04-18 — current as of commit `3396e21`
