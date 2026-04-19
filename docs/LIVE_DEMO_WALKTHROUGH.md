# 🎬 Live Demo Walkthrough — AI Health Check

This is your rehearsal. Assume the examiner is watching every click. It walks each of the 9 steps with: **what they see**, **where it bites you live**, and **demo-day mitigations** drawn from the actual code. Plus a pre-flight checklist and three "killshot" moments that move the grade from B+ to A.

---

## 🧰 Pre-flight checklist (do this 15 minutes before)

1. **Backend up**: `uvicorn app.main:app --reload --port 8000` → browse http://localhost:8000/docs and confirm routes load. The lifespan hook installs the audit-log triggers; if it's not visible in logs, the hash-chain demo will fail.
2. **Frontend up**: `npm run dev` → browse http://localhost:5173 and log in as **admin@aiops.local / admin123**. Don't log in as viewer first; tokens don't revoke.
3. **Seed the DB**: run `python -m app.seed` if you've reset. Verifies 3 services exist, 6 test cases exist, a handful of historical eval runs exist so the dashboard isn't empty.
4. **Warm the LLM**: hit Dashboard → "Generate insight" once **before** the grader arrives so DNS + Anthropic TLS is established. Cold first call can take 8-10 seconds.
5. **Narrow the export date range**: set From = today, To = today. Default 7-day window will show too much noise.
6. **Open the right tabs in order**: Dashboard → Services → Evaluations → Incidents → Governance. Use the Cmd+K palette to navigate; it's impressive.
7. **Have copy-paste ready** in a local text file:
   - Reviewer note: `Read full draft — root causes match the checklist findings. Stakeholder update is factual with no fabricated claims.`
   - Symptoms: `Quality score dropped to 42% on the 14:32 UTC scheduled eval. Factuality failing on 3/6 test cases; no infra changes since yesterday.`
   - Rollback plan: `Revert eval prompt to v1.3 (commit a7c8f2). Re-deploy via standard deploy pipeline.`
   - Validation steps: `Run full eval suite, confirm quality ≥ 85%, monitor P95 latency for 30 minutes post-deploy.`

---

## Step 1 — Register a service

**What they see:** Services page → "Register" button → fill name / owner / environment / model / sensitivity / endpoint → submit. New card appears with the sensitivity badge. Click **Ping** → green healthy dot with latency in ms.

**Where it bites you live:**
- **SSRF validator will reject anything local.** `http://localhost:8000/health` or `http://127.0.0.1` returns HTTP 400 *"Hostname resolves to blocked range"*. Looks like your app is broken. It's not — it's the protection working against you.
- **Confidential sensitivity triggers a JS `confirm()` on Ping.** If you pick "confidential" in the demo service, you'll get an unexpected modal the second you click Ping.
- **`example.com` subdomains don't resolve** on some networks. `staging.example.com` will 400. Use a real public URL like `https://httpbin.org/status/200`.

**Demo-day mitigations:**
- Use `https://httpbin.org/status/200` as the endpoint — returns a clean 200 with predictable latency.
- Set sensitivity = **internal** for the demo service. Save confidential for a separate "watch this security feature" moment (Killshot #1 below).
- If asked "what about localhost?" → say it out loud: *"That's deliberately blocked. Let me show you."* Attempt to register `http://169.254.169.254/meta-data/` → grader sees the 400 → **that's a killshot moment for the SSRF guard.**

---

## Step 2 — Monitoring detects a quality drop

**What they see:** Dashboard loads. Four metric cards with trend arrows. Response-time distribution (Typical/Slow/Worst). Line chart for latency, bar chart for quality per run, area chart for error rate. Recent evaluations table.

**Where it bites you live:**
- **Fresh DB has zero eval runs** → cards show 0%, charts are empty. The dashboard looks unimpressive.
- **Scheduler fires mid-demo**. Every 5 min the health check runs → new ConnectionLog rows appear → metrics shift unexpectedly.
- **The "Generate insight" endpoint now creates a draft** (not a response). If you forget this, you'll click and say "where did it go?" — it's in the draft table waiting for approval.

**Demo-day mitigations:**
- Before the demo, run 5-10 evals against each seeded service so the trend charts have a visible slope.
- Temporarily raise `health_check_schedule_minutes` to 60 so the scheduler doesn't interfere during the 10-minute window.
- Hover over a metric card's (i) icon to show the tooltip — demonstrates your UX polish and the tooltips you added.

---

## Step 3 — Drift flag triggers

**What they see:** Evaluations page → click **Run** next to a service → cost-preview modal ("$0.012 estimated") → confirm → progress indicator → results row appears with `drift_flagged = true` and a **critical** severity badge. Dashboard gains a red **Active Alerts** banner.

**Where it bites you live:**
- **The eval takes 5-15 seconds.** Dead air on stage. Grader wonders if it crashed.
- **Claude might score well enough to NOT trigger drift.** You run the demo eval hoping for a failure — and get 85%. Now what?
- **Budget race test may have consumed calls.** If earlier demos/tests ate today's $5 budget, this returns 402.
- **If the service is confidential**, the eval requires `?allow_confidential=true` → frontend shows the override confirm. Fine but slows you down.

**Demo-day mitigations:**
- **Plant a guaranteed-failure test case.** Create an EvalTestCase with `expected_output="Paris"` for prompt `"What is the capital of France?"` but re-word the prompt deliberately to induce a long-winded answer that won't fullmatch. Or expected_output that's clearly different from what Claude produces.
- **Narrate during the wait**: *"Each test case is going through our pipeline — input safety scan, budget check under concurrency lock, API call, output scan, usage log. This is why the timing feels deliberate."*
- **Backup**: have a pre-recorded EvalRun in the DB with `drift_flagged=True, quality_score=42`. If live fails, refresh → still see the drift alert on Dashboard.
- **Show the cost-preview modal** *before* confirming. Demonstrates cost awareness: *"The app estimates the spend before any call is made."*

---

## Step 4 — Incident is created

**What they see:** Incidents page → "Report" → form with service dropdown, severity, symptoms, 5-checkbox triage list, timeline → submit → list shows new INC-N row with red severity badge.

**Where it bites you live:**
- **Required fields are ambiguous.** Grader may see unclear validation messages if you forget symptoms.
- **No auto-link from alert to incident.** Your Alert row and new Incident are related conceptually but not via FK. If asked "how does the alert tie to the incident?" — be honest: it's traceable via service_id + timestamp + audit log, not a direct FK.

**Demo-day mitigations:**
- Paste the pre-prepared symptoms (above) and pre-check `Data Issue` and `Prompt Change` — the two checkboxes that match the drift scenario.
- Narrate: *"I'm picking the same service the alert fired on. The drift severity was critical, so I'm picking severity=high."*

---

## Step 5 — Triage checklist is used

**What they see:** Incident detail page → left column shows the 5 checklist items with Yes/No indicators → Symptoms paragraph → right column is where the summary will land.

**Where it bites you live:**
- **Checklist doesn't "do" anything visually** until you generate the LLM summary. Grader may ask "so what?"
- **If you forget to check items at creation, the LLM gets "No" for all** and produces a generic summary.

**Demo-day mitigations:**
- Explicitly narrate: *"These five checkboxes feed directly into the LLM prompt for root-cause analysis. Watch."* Then move to Step 6. The LLM output will reference the checked items, closing the loop.

---

## Step 6 — LLM generates summary (human approves) 🎯

**What they see:** Click **Generate draft** → wait → draft appears with "STAKEHOLDER UPDATE" + "ROOT CAUSES" sections → yellow pending banner → click **Approve** → `window.prompt` appears asking for reviewer note → paste the pre-prepared note → submit → green approved state, summary published.

**Where it bites you live:**
- **LLM call is 5-10s.** Silence.
- **`window.prompt` looks crude** on screen. Some graders may mistake it for a bug.
- **Short note rejection**: if the note is <20 chars, the frontend alerts AND the backend 400s. Don't try "lgtm" for laughs — it'll reject and feel like a failure.
- **Double-click the approve button**: second click returns 409 Conflict. If the first click had a transient error and you retry, you'll hit this.
- **Budget/rate limit:** if earlier LLM calls exhausted quota, the generate 402/429s with a clear message but the moment is dead.

**Demo-day mitigations:**
- **Say the approval contract out loud BEFORE clicking**: *"Notice: the approve button requires a reviewer note of at least 20 characters. This forces the human in the loop to articulate what they verified — not rubber-stamp. I've prepared one."*
- Paste the pre-typed note, submit, then **immediately navigate to Governance → Audit Log** and filter for `approve_summary` → show the `new_value` contains `reviewer_note_len=64`. This is the moment the grader writes down "HITL works."
- If the LLM call is slow, narrate the pipeline: *"This is going through safety scan, budget check, then Anthropic, then output scan, then drafting. Designed for governance, not speed."*

---

## Step 7 — Maintenance plan is created

**What they see:** Same incident detail page → "Add plan" → form with risk level, rollback plan, validation steps, scheduled date, "human_approved" checkbox → submit → plan appears in the timeline view (with the hairline spine and ringed node dots you added in the UI redesign). Click **Approve** → green "Approved" state.

**Where it bites you live:**
- **Two-step: create then approve.** If you forget the approve step, the plan sits as pending. Grader may miss the distinction.
- **Admin-only approval.** If demoing as maintainer, the approve button 403s.
- **`scheduled_date` input** is a native `datetime-local` picker — can be fiddly on stage.

**Demo-day mitigations:**
- Stay as **admin** for the whole demo.
- Show the Approve button change state visibly — the ringed dot on the timeline flips green.
- Narrate the architectural rhyme: *"Same human-in-the-loop pattern as the incident summary. Different domain, same contract."*

---

## Step 8 — Audit log records actions 🎯

**What they see:** Governance page → audit log table populated with the demo's recent actions (login_success, create_service, run_evaluation, alert_created, create_incident, generate_summary_draft, approve_summary, create_maintenance_plan, approve_maintenance_plan). Each row shows timestamp, user, action, target.

**Where it bites you live:**
- **Viewer-role users see a blank page** (audit log is admin-gated). If you accidentally logged in as viewer to "test RBAC," the audit log won't load.
- **No obvious way to prove it's tamper-proof** unless you click the Verify button — which most demos skip.
- **Audit log can have thousands of rows** from the scheduler or older runs. Noisy.

**Demo-day mitigations:**
- **Click "Verify integrity" live.** Green check + "Chain intact — 47 entries verified." is a visceral moment.
- Filter the table to `approve_summary` so the grader sees your end-to-end chain: draft → approve with note → audit.
- **KILLSHOT**: open a SQL shell on the side, run `UPDATE audit_log SET action='tampered' WHERE id=3` (the SQLite trigger will block this via the app path, so you'll need to use `sqlite3 aiops.db` directly, DROP the trigger, update, recreate). Click Verify again → red "BROKEN at id 3" with the specific reason. Grader writes "tamper evidence works." This is a **9/10 → 10/10 moment**. Rehearse it; if it works, it's worth it. If rehearsal breaks, skip.

---

## Step 9 — Compliance report is exported 🎯

**What they see:** Governance page → date range picker (set to today) → click **PDF** → file downloads → open → title page, three sections (Audit Log, Incidents, Maintenance Plans) with styled tables. Also show JSON to demonstrate the structured payload.

**Where it bites you live:**
- **Date range mismatch.** Default 7 days back; if your demo day is a Monday and seed data was from Friday, you may get either nothing or too much.
- **Row truncation** if seed data is large — the red warning banner shows up but grader may see it as a bug.
- **PDF generation takes ~1 second.** Tiny but noticeable.
- **Reviewer unfamiliar with JSON** → the export JSON looks overwhelming.

**Demo-day mitigations:**
- Pre-set date range to **today only**.
- Open the downloaded PDF side-by-side with the Governance page. Point to the three sections.
- Show the JSON in a separate tab and highlight the `warnings: []` array: *"When the export truncates, it says so loudly. No silent compliance evidence holes. Here's the test that proves it..."*  — then briefly show `test_export_reports_truncation_warning` in the test file.

---

## 🎯 Three killshot moments worth 1-2 letter grades

Pick **at least one** of these. They're the difference between "yes they built it" and "wow, they thought about threats."

1. **SSRF live block.** During Service registration, type `http://169.254.169.254/meta-data/` and hit submit. The backend returns *"Unsafe endpoint URL: hostname resolves to blocked range."* Narrate: *"The AWS metadata service lives at that address. If any user could register it as a 'service' we'd exfiltrate IAM credentials on every health check. Blocked."*

2. **Audit integrity verify live.** Click **Verify integrity** → green. Then (rehearsed) tamper a row → click again → red with broken_at. Narrate: *"Every row is chained by SHA-256. We detect after-the-fact tampering. Same pattern as Git."*

3. **HITL reviewer note.** Click Approve on an incident summary. Show the `window.prompt`. Narrate: *"Approval requires 20+ characters of reviewer note. Enforced by Pydantic at the request layer, re-checked after whitespace strip on the server. No silent rubber-stamping."* Then paste, submit, and go show the audit log row with `reviewer_note_len=N`.

---

## 📊 Q&A bait to prepare for

**"What happens if two admins approve the same summary?"** → 409 Conflict. Attribution is preserved. We have a test: `test_approve_is_idempotent_409_on_second_call`.

**"How do you know the drift detection isn't just a threshold?"** → Show `_compute_trend()` — it splits the last N scores and compares halves. A slowly declining service still above threshold will still fire. Documented in `EVAL_DATASET_CARD.md`.

**"What stops a maintainer from running evals on confidential services?"** → `enforce_sensitivity()` in `services/sensitivity.py`. They'd need the `allow_confidential=true` flag AND the admin role. Even with the flag, a maintainer gets 403.

**"Can an attacker bypass the rate limit with concurrent calls?"** → No. Budget check + reservation INSERT run under `_BUDGET_LOCK` in `llm_client.py`. We have a test: `test_concurrent_calls_respect_user_rate_limit` — 20 concurrent callers, limit of 5, asserts ≤ 5 succeed.

**"Can the audit log be tampered with?"** → Direct DB write is theoretically possible since we're on SQLite, but the SHA-256 hash chain detects it on next verify. Production should use Postgres with row-level WORM permissions. Documented as R9 residual.

**"What's the biggest remaining risk?"** → Pick one and go deep. Good answer: *"Judge refusals. LLM-as-judge is non-deterministic. If Claude's refusal behaviour shifts globally, a large fraction of our evals could become `judge_refused` and the drift signal weakens. We handle it by excluding refused rows from the aggregate — but the quality signal gets noisier, not wrong. That's why the maintenance runbook has a monthly check on refusal rate."*

---

## ⏱ Realistic timing

| Step | Target | Max acceptable |
|---|---|---|
| 1. Register | 45s | 90s |
| 2. Dashboard | 30s | 60s |
| 3. Drift trigger | 60s | 120s (LLM latency) |
| 4. Incident create | 30s | 60s |
| 5. Checklist narration | 15s | 30s |
| 6. LLM + approve | 90s | 180s (LLM + note) |
| 7. Maintenance plan | 45s | 90s |
| 8. Audit log + verify | 45s | 90s (with tamper demo: 120s) |
| 9. Export | 30s | 60s |
| **Total** | **~6.5 min** | **~12 min** |

Budget 7-8 minutes for the walkthrough plus 3-5 for Q&A. If you hit the timing, you project command of the system — which is half the grade.

Go get the A.
