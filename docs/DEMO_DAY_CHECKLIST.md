# Demo Day Checklist

> Last updated: 2026-04-18 · current as of commit `e2dc632`
>
> Operational checklist for demo day. Complements the
> [LIVE_DEMO_WALKTHROUGH](LIVE_DEMO_WALKTHROUGH.md) (what to click and
> say) with the logistics (how to prepare the environment and recover
> if it breaks).

---

## 📅 Night before

### Code + data
```bash
# Pull latest
git checkout main && git pull

# Set demo-mode env flags in backend/.env
echo "SCHEDULER_ENABLED=false" >> backend/.env
echo "LOG_SQL=false" >> backend/.env

# Rebuild the DB with fresh seed (includes the pre-seeded drift scenario)
cd backend
lsof -ti:8000 -sTCP:LISTEN | xargs kill 2>/dev/null
rm -f aiops.db
source venv/bin/activate
python -m app.seed
```

Expected seed output includes:
```
[Seed] Created 3 default users (admin, maintainer, viewer)
[Seed] Created 3 sample AI services
[Seed] Created 6 eval test cases
[Seed] Created 15 historical eval runs (with 1 pre-flagged drift scenario)
[Seed] Created 1 drift alert for 'Internal Report Generator' (demo-ready)
```

### Smoke test the full stack
```bash
# Terminal 1 — backend
cd backend && source venv/bin/activate && uvicorn app.main:app --port 8000

# Terminal 2 — frontend
cd frontend && npm run dev
```

Browser: http://localhost:5173 → login `admin@aiops.local / admin123` → Dashboard should show:
- 3 active services
- **Red "Active Alerts" banner** ("Internal Report Generator quality dropped to 42.0%")
- Recent evaluations table with mixed-quality rows
- Charts populated with 7 days of data

If any of the above is missing, re-run the seed.

### Copy-paste snippets (have in a local text file)
- **Reviewer note** (for incident approve):
  > Read full draft — root causes match the checklist findings. Stakeholder update is factual with no fabricated claims.
- **Symptoms** (for incident create):
  > Quality score dropped to 42% on the 14:32 UTC scheduled eval. Factuality failing on 3/6 test cases; no infra changes since yesterday.
- **Rollback plan**:
  > Revert eval prompt to v1.3 (commit a7c8f2). Re-deploy via standard deploy pipeline.
- **Validation steps**:
  > Run full eval suite, confirm quality ≥ 85%, monitor P95 latency for 30 minutes post-deploy.

### Printable references
- [LIVE_DEMO_WALKTHROUGH](LIVE_DEMO_WALKTHROUGH.md) § "Three killshot moments" + timing table (one page)
- [VIVA_QA_PREP](VIVA_QA_PREP.md) — print only the 🏆 ideal-answer paragraphs (10 paragraphs, one page)
- [SELF_CRITIQUE](SELF_CRITIQUE.md) — skim the "honest answer" lines only

### Hardware
- Laptop charged to 100%, charger in bag
- HDMI / USB-C / Thunderbolt adapter for the venue projector
- Backup: screen-record the full 9-step demo tonight as a fallback (phone on tripod, or `brew install --cask obs` if you don't have one)

---

## 🌅 Morning of (at home, 60 min before)

```bash
# Quick full boot + verify
cd ai-health-check
git status    # should be clean
git log --oneline -1    # should be e2dc632 or newer

# Backend
cd backend && source venv/bin/activate && uvicorn app.main:app --port 8000
# Expect: "[Startup] Background scheduler DISABLED (SCHEDULER_ENABLED=false)"

# Frontend (new terminal)
cd frontend && npm run dev
```

Open browser, log in, click through each page quickly (Dashboard → Services → Evaluations → Incidents → Governance → Settings → Data Policy). Watch the terminal for any errors. If any page 500s, something drifted overnight — rebuild the DB.

### Browser / desktop prep
- **Zoom level**: 125% or 150% so projector viewers can read
- **Full-screen the browser** (not presentation mode — just maximized so the URL bar stays visible)
- **Close all other tabs**
- **Mute notifications**: macOS Focus → Do Not Disturb
- **Close Slack, Messages, email, calendar popups**
- **Projector test**: mirror vs extend; practice both so you know which one the venue is set for

### Terminal layout
Keep ONE terminal visible with backend logs. The examiner may glance at it; you want clean output, not SQL noise. That's what `LOG_SQL=false` is for.

### Warm the LLM
```bash
# Before the grader arrives, hit Dashboard once and click "Generate insight"
# (or any action that triggers a Claude call).
# This establishes the DNS + TLS connection so the demo call isn't cold.
```

---

## ⏱ T-15 min at the venue

```bash
# Kill anything stale, full restart
cd backend && lsof -ti:8000 -sTCP:LISTEN | xargs kill 2>/dev/null
source venv/bin/activate && uvicorn app.main:app --port 8000

# Frontend in new terminal
cd frontend && npm run dev
```

Log in as admin in the browser. **Leave the tab on the Dashboard**. First thing the examiner sees: a real-looking platform with a real-looking alert.

### Last sanity checks
- [ ] Dashboard shows the red Active Alerts banner
- [ ] Clicking into any service page loads without error
- [ ] ⌘K command palette opens (shows your keyboard-shortcut polish)
- [ ] Theme toggle works (dark ↔ light, both look clean)

---

## 🎬 During the demo

Follow the [LIVE_DEMO_WALKTHROUGH](LIVE_DEMO_WALKTHROUGH.md) 9-step script. Target ~6.5 min walkthrough, max 12 min.

Terminal visible at all times (examiner peripheral attention). If you need to show audit-log details, have a second browser tab open to http://localhost:8000/docs (FastAPI OpenAPI page) — it's a credibility boost.

### Killshot moments to work in
1. **SSRF live block** (during Step 1 if you have time) — try to register `http://169.254.169.254/meta-data/` → examiner sees the 400.
2. **Audit integrity verify** (during Step 8) — click the Verify button → green "Chain intact — N entries verified."
3. **HITL reviewer note** (during Step 6) — say the 20-char requirement aloud before clicking Approve.

---

## 🚨 Recovery procedures — if it breaks

### Backend 500s on any page
```bash
# Check the terminal for the stack trace. Usually one of:
# - DB schema drift (models changed, DB is old)
# - Missing env var (ANTHROPIC_API_KEY empty)
# - Port conflict
```

### Nuclear reset (30 seconds, always works)
```bash
cd backend
lsof -ti:8000 -sTCP:LISTEN | xargs kill 2>/dev/null
rm -f aiops.db
source venv/bin/activate
python -m app.seed
uvicorn app.main:app --port 8000
```
Then reload the browser tab and log in again. You'll lose any state generated during the previous demo attempt, but you're back to the pre-seeded baseline in under a minute.

### Claude API rate-limited or budget exceeded
- Stay calm. Say: *"We've hit today's $5 budget cap — which is a governance feature, not a bug. The app refuses to exceed the cap."*
- Pivot to the pre-seeded drift alert (Dashboard has it already) and narrate the compliance export path instead.
- Don't attempt another eval run — it'll 402 on screen.

### Frontend white-screens
```bash
# Hard refresh
Cmd+Shift+R
# Or restart dev server
cd frontend && npm run dev
```

### Network is down (venue wifi failed)
- Local demo still works — everything runs on localhost except Claude API calls.
- You can still show: Dashboard, Services, Evaluations (no live run), Incidents (no generate-summary), Governance (including audit log verify), compliance export.
- Skip steps 3 and 6 from the walkthrough. Pre-seeded drift covers you.

### Projector disconnects mid-demo
- Pause, unplug + replug, keep narrating. *"Our system handles outages gracefully — let me show you the offline path while that reconnects..."* — then reference the pre-seeded drift.

---

## 📋 Post-demo (for the viva)

### If individual Q&A follows
Have [VIVA_QA_PREP](VIVA_QA_PREP.md) reviewed within the last 30 min. The magic phrases:
- *"It's a heuristic. A production implementation would do X."*
- *"In-app adversary yes, privileged host no."*
- *"Forcing function for deliberation, not enforcement."*
- *"Documented in X.md §Y."*

### If the examiner asks "could this run in production?"
Don't say yes. Don't say no. Say:
> *"We've mapped it against HIPAA, SOX, and EU AI Act in [GOVERNANCE_AUDIT.md](GOVERNANCE_AUDIT.md). The short version: not without a 6-12 week remediation program on MFA, encryption at rest, a vendor BAA, four-eyes approval, and external audit-log anchoring. We built a governance-aware prototype with real security-hardening work — the compliance wrapper is documented as the gap."*

---

## ✅ The one-page pre-demo checklist

Print this. Keep it on the desk. Cross items off in the 15 min before demo:

- [ ] Laptop at 100% + charger plugged in
- [ ] `git log --oneline -1` shows `e2dc632` or newer
- [ ] `backend/.env` has `SCHEDULER_ENABLED=false` and `LOG_SQL=false`
- [ ] Backend running on :8000 — terminal shows "scheduler DISABLED"
- [ ] Frontend running on :5173 — no Vite errors in terminal
- [ ] Browser at http://localhost:5173 on the Login page
- [ ] Login works with `admin@aiops.local / admin123`
- [ ] Dashboard shows the red Active Alerts banner
- [ ] ⌘K command palette opens
- [ ] Notifications muted (Do Not Disturb on)
- [ ] Copy-paste snippets open in a separate text file
- [ ] Backup video recorded from last night's run
- [ ] VIVA_QA_PREP ideal answers printed

Go.
