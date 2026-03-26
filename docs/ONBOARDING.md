# AIHealthCheck: System Onboarding & Monitoring Lifecycle

Welcome to the AIHealthCheck (ARTI-409-A) development team! This platform acts as an **air-traffic control tower** for deployed AI applications.

If you are new to the project, here is the step-by-step lifecycle of how the system operates from end-to-end, focusing specifically on how the platform actively monitors and evaluates the AI models in our ecosystem.

---

## Step 1: Registration (Service Registry)
Before the platform can monitor an AI model, it needs to be attached to the registry.
- In the **Services** module (Module 1), administrators register an AI feature (e.g., "Customer Support Bot", "Financial Analyzer").
- The registry tracks the **LLM model identifier** (like `claude-3-opus-20240229`), who the **Owner** is, and tags it with a **Sensitivity Badge** (Public, Internal, Confidential). 
- *Why it matters:* This registry acts as the single source of truth for every AI endpoint the company runs. No shadow AI can exist without being tracked here.

## Step 2: Active Monitoring & Evaluations (The Core Engine)
This is exactly how the platform watches our AI models (Module 2). The backend utilizes `APScheduler` (a Python background task runner) to ping models in two distinct ways:

**A. Health & Latency Pings (Constant)**
- Every few minutes, the backend shoots a tiny, generic prompt (a "health check ping") to Anthropic's Claude API via our abstraction wrapper (`/services/llm_client.py`). 
- It records exactly how many milliseconds it took to get a response and whether the connection succeeded or failed (Error Rate). These are the numbers seen on the line graphs in the main **Dashboard**.

**B. Quality & Concept Drift Evals (Scheduled)**
- Periodically, the backend runs a **Synthetic Evaluation Batch**. It takes a pre-defined list of test prompts (e.g., *"How do I reset my password?"*) and sends them to the model through the endpoints.
- It then automatically scores the response quality (e.g., checking for hallucinations, correct formatting, or blocked safety words). This generates the **Quality Score** bar charts.
- **Concept Drift:** If a model used to score 95% on a standard test format, but suddenly drops to 70%, the system flags this as **"Concept Drift"** and triggers a red banner alert so engineers can investigate if the underlying LLM provider changed their model weights.

## Step 3: Incident Triage (When things go wrong)
If latency spikes or concept drift triggers an alert, the engineering team steps in (Module 3).
- In the **Incidents** module, engineers declare an incident ticket (e.g., "High Severity: Support Bot Hallucinating").
- They use the **Diagnostic Checklist** to isolate the root cause (Was there a prompt change? Did Anthropic update their model API? Is it a data pipeline issue?).
- **AI-Assisted Drafting:** To save time, engineers can click "Generate AI Summary". The platform uses Claude to read the telemetry metrics and write a draft incident report / post-mortem, which the human can then approve or reject.
- Finally, they use the **Maintenance Planner** to schedule a rollback or deployment fix.

## Step 4: Governance & Compliance
Large organizations need to prove they are handling AI safely to external auditors (Module 4).
- Every time a service is created, a prompt is tested, an incident is closed, or an admin changes a user's Role-Based Access level (RBAC), the **Governance** module silently writes an immutable record to the SQLite Database `audit_log` table.
- At the end of the quarter, the compliance team navigates to the Governance page, selects a date range, and clicks **Export PDF/JSON** to generate cryptographic proof that all AI models are being safely monitored and incident procedures were correctly followed.

---
**Summary:** We track what models we have (Registry) → Run scheduled prompt tests to ensure quality hasn't decayed (Monitoring) → Isolate and rollback issues rapidly (Incidents) → Create an immutable paper-trail of accountability (Governance).
