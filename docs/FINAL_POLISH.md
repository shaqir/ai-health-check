# Final Polish Checklist — Near-Final Submission Review

> Grading-assistant review of the near-final state. These are surgical
> changes, not rebuilds. Each item is under 60 minutes and each is
> visible to an examiner. Ordered by marks-per-minute within each
> category.

This doc complements:
- [LIVE_DEMO_WALKTHROUGH.md](LIVE_DEMO_WALKTHROUGH.md) — day-before rehearsal
- [VIVA_QA_PREP.md](VIVA_QA_PREP.md) — 2-minute Q&A prep
- [SELF_CRITIQUE.md](SELF_CRITIQUE.md) — methodological gaps to own, not fix

Read this 1–2 days before submission. Execute the top-5 shortlist (≈110
min) and you move from "good project with rough edges" to "polished
submission." The remaining items are optional.

---

## 🧭 Clarity (3 items)

### 1. Show the approver on approved items — not just a user_id
**Problem.** `incident.approved_by` is stored, but the frontend doesn't surface it. A grader reviewing an approved incident sees the summary but not *who* signed off. The HITL narrative is weakened.

**Fix.** `IncidentDetailPage.jsx` — add a small "Approved by *admin@aiops.local* at *14:32 UTC*" line under the published summary. Backend already returns `approved_by`; fetch the user email once into a lookup cache, render the pair. Same for maintenance plans. 20 min.

**Why it matters.** This is the visible proof that HITL actually runs. Without it, the reviewer_note work looks invisible on stage.

---

### 2. Audit log action strings are snake_case — render them human
**Problem.** The audit table shows `approve_summary`, `login_success`, `confidential_llm_override`. Functionally fine, visually sloppy.

**Fix.** In `GovernancePage.jsx` `auditColumns`:
```jsx
{ key: 'action', render: (v) => v.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()) }
```
Shows "Approve Summary", "Login Success" etc. 5 min. Keep the raw `action` in the backend filter so existing filter UX still works.

**Why it matters.** A grader scans a dozen audit rows in 3 seconds. Title-cased actions feel like a product, snake_case feels like a database dump.

---

### 3. Cost preview ambiguity
**Problem.** The cost preview modal says `$0.0120 est`. A grader parsing that quickly reads "$12" or "$0.012?" — ambiguous.

**Fix.** `EvaluationsPage.jsx` handleRunEval prompt string: `` `Est. cost: $${p.estimated_cost_usd.toFixed(4)} (~${(p.estimated_cost_usd * 100).toFixed(1)}¢)` ``. 2 min.

**Why it matters.** Governance signal. Shows cost-awareness is real, not decorative.

---

## 🎯 Professionalism (3 items)

### 4. Replace `window.confirm` and `window.prompt` with your Modal component
**Problem.** You already built a proper `Modal.jsx` with focus trap, accessible dialog, blur backdrop. Then you use `window.confirm` / `window.prompt` in three places:
- `ServicesPage.jsx` — confidential service Ping warning
- `EvaluationsPage.jsx` — confidential run warning + cost preview
- `IncidentDetailPage.jsx` — reviewer note input

Browser-native prompts look amateur on a polished UI. Examiner notices immediately.

**Fix.** Reuse the existing Modal. Three small components: `ConfidentialWarningModal`, `CostPreviewModal`, `ReviewerNoteModal`. Each is ~50 lines. ~45 min total.

**Why it matters.** Your UI is visibly good until these three moments. Removing the break in visual language is the single highest-ROI polish on the whole project.

---

### 5. Silence SQLAlchemy echo for the demo
**Problem.** `.env` has `debug=True`, which makes SQLAlchemy log every SQL statement to the terminal. During demo, every page click floods the terminal with 20 lines of SQL. If you alt-tab to the terminal to show a log line, the grader sees chaos.

**Fix.** Either set `DEBUG=false` in `.env` before demo, or (better) gate the echo specifically:
```python
# database.py
engine = create_engine(
    settings.database_url,
    connect_args={"check_same_thread": False},
    echo=settings.debug and settings.log_sql,  # new flag, default false
)
```
Add `log_sql: bool = False` to `config.py`. 10 min.

**Why it matters.** Terminal cleanliness reads as operational maturity. Noise reads as dev-mode.

---

### 6. Backend error `detail` should reach the user verbatim
**Problem.** Several frontend handlers show `alert('Failed to approve summary')` on any error — swallowing the actual backend message. The backend returns beautifully specific errors ("Summary already approved by user 1 at 2026-04-18T23:06:53"), but users see the generic.

**Fix.** Across IncidentDetailPage, EvaluationsPage, ServicesPage: change `alert('Failed X')` to `alert(err.response?.data?.detail || 'Failed X')`. 10 min total, 5-6 call sites.

**Why it matters.** If a grader triggers a 409 during the demo (accidental double-click), showing "Summary already approved by user 1 at X" demonstrates the idempotency guard working. Showing "Failed to approve" demonstrates nothing.

---

## 🎬 Demo flow (3 items)

### 7. Pre-seed one service with drift already flagged
**Problem.** Fresh seed has healthy services and healthy eval runs. To show the Dashboard's drift alert banner on login, you have to run a live eval that *happens to fail* — which Claude might not do reliably on the demo day.

**Fix.** Update `seed.py` to include one EvalRun for Service 2 with `quality_score=42, drift_flagged=True`, AND the matching Alert row + audit log entry. Now the Dashboard shows "Active Alerts" immediately on login. 20 min.

**Why it matters.** First 10 seconds of demo show: a real-looking dashboard with a real-looking problem. That framing does a lot of work.

---

### 8. Disable the scheduled health check during demo
**Problem.** `scheduled_health_check` runs every 5 minutes. Mid-demo it fires, creates ConnectionLog rows, shifts your metrics. Also makes terminal noisy even with SQL silenced.

**Fix.** Add to `config.py`: `scheduler_enabled: bool = True`. In `main.py::lifespan`, wrap `scheduler.add_job(...)` in `if settings.scheduler_enabled:`. Then for demo: set `SCHEDULER_ENABLED=false` in `.env`. 5 min.

**Why it matters.** Predictability. The dashboard stays stable during narration.

---

### 9. Add a demo-reset endpoint (admin-only, audited)
**Problem.** Re-running the demo requires deleting `aiops.db`, restarting backend, re-seeding. Three terminal commands, error-prone under pressure.

**Fix.** One endpoint: `POST /api/v1/admin/reset-demo` (admin-only, audit-logged). Truncates `incidents`, `maintenance_plans`, `eval_runs`, `eval_results`, `alerts`, `ai_llm_drafts`, `api_usage_log` — preserves users and services. Single click to reset for a second demo attempt.

30 min including frontend button. Gate behind `settings.demo_mode` so it can't exist in production.

**Why it matters.** Confidence. If Q1 goes sideways, you can reset and retry without visible stress.

---

## 📚 Documentation quality (3 items)

### 10. Add `docs/README.md` as a reading guide
**Problem.** 10 docs in `docs/`. The main README links them all but doesn't prioritize. A grader doesn't know where to start.

**Fix.** New `docs/README.md`:
```markdown
# Documentation map

## If you're grading this project
Read in order: ARCHITECTURE, MODULE_GUIDE, RISK_REGISTER, SELF_CRITIQUE.

## If you're setting it up
Read: ONBOARDING, then TESTING_STRATEGY.

## If you're a regulated-industry reviewer
Read: GOVERNANCE_AUDIT, RISK_REGISTER.

## If you're rehearsing the viva
Read: LIVE_DEMO_WALKTHROUGH, VIVA_QA_PREP, SELF_CRITIQUE.
```
15 min.

**Why it matters.** Shows docs were *organized*, not just written. Signals team discipline.

---

### 11. Add TOCs to the three longest docs
**Problem.** `ARCHITECTURE.md`, `GOVERNANCE_AUDIT.md`, `LIVE_DEMO_WALKTHROUGH.md` are 200+ lines each. Scroll fatigue. A reviewer on GitHub has no side nav.

**Fix.** Add a `## Contents` section after the title with anchored links to each major heading. GitHub auto-anchors `##` headings. 5 min per doc.

**Why it matters.** Respect for the reader's time is graded.

---

### 12. Add "Last updated: YYYY-MM-DD" header to each doc
**Problem.** Several docs were written at different points. Without dates, a reviewer wonders if they're current.

**Fix.** One-line header on each: `> Last updated: 2026-04-18 — current as of commit d2bf544`. 10 min for all docs.

**Why it matters.** Signals that the docs are maintained, not snapshots.

---

## 🔧 Small technical refinements (3 items)

### 13. Add indexes on timestamp columns
**Problem.** `api_usage_log.timestamp`, `audit_log.timestamp`, `connection_logs.tested_at`, `eval_runs.run_at` — none have explicit indexes. Not visible in demo, but a professor who checks `models/__init__.py` will ask.

**Fix.**
```python
timestamp = Column(DateTime, default=utcnow, index=True)
```
on the four tables. 2 min. Requires a DB rebuild.

**Why it matters.** One line. Forestalls a viva question.

---

### 14. Set a custom favicon + tab title
**Problem.** The browser tab may show the default Vite icon. For a polished demo that's a giveaway.

**Fix.** Check `frontend/index.html` — confirm `<title>` says "AI Health Check" (already done in UI redesign). If the favicon is still default Vite, swap it for a minimal 32×32 SVG (a heartbeat-line icon fits the name). 15 min including SVG.

**Why it matters.** First impression. The browser tab is the first thing visible on a projected screen.

---

### 15. Show "last verified" timestamp on audit integrity
**Problem.** The Governance page has a "Verify integrity" button that shows green/red, but no memory — each click is a new verification. A grader wonders "is the chain actually checked regularly?"

**Fix.** Persist the last verification result (localStorage + timestamp at minimum). Show: "Last verified: 2 minutes ago — intact (123 entries)". Auto-re-verify every 5 min while the page is open. 20 min.

**Why it matters.** Distinction between "we have a verify endpoint" and "we continuously verify."

---

## 🎯 If you can only do 5

Ranked by marks-per-minute:

1. **#4 Replace window.prompt / window.confirm with Modal** — biggest professional-feel upgrade. 45 min.
2. **#7 Pre-seed a drift scenario** — ensures demo works regardless of Claude mood. 20 min.
3. **#1 Show approver email + timestamp** — makes HITL visible. 20 min.
4. **#5 Silence SQLAlchemy echo** — clean terminal during demo. 10 min.
5. **#10 docs/README.md reading guide** — organizes 10 docs into one signal. 15 min.

**Total: ~110 minutes** to move from "good project with rough edges" to "polished submission."

---

## What NOT to do

Skip the temptation to:

- **Rewrite the Settings page** — the current two-column layout works and graders only glance.
- **Add a login page hero image or illustration** — the minimal material card is appropriate. More would look unserious.
- **Add animations beyond what exists** — transition tokens are tasteful; more motion risks cartoon territory.
- **Refactor the backend routers further** — the split into users/audit/export is already clean.
- **Rebuild the design system** — it's consistent; minor touches only.

Polish, don't rebuild. 90% there. The last 10% is discipline on the final pass.
