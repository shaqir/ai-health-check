# AIHealthCheck Onboarding Guide

## Overview

AIHealthCheck is a monitoring and governance platform for deployed AI services. It provides continuous health checking, evaluation-based drift detection, incident triage with AI-assisted drafting, budget enforcement, prompt safety scanning, and compliance auditing. The platform runs on Claude Sonnet 4.6 (`claude-sonnet-4-6-20250415`) via the Anthropic SDK.

## Prerequisites

- Python 3.11 or later
- Node.js 18 or later
- An Anthropic API key (set as `ANTHROPIC_API_KEY` in your environment)

## Setup Steps

### Backend

```bash
cd backend
python -m venv venv
source venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload
```

The API starts at `http://localhost:8000`. Interactive docs are available at `/docs`.

### Frontend

```bash
cd frontend
npm install
npm run dev
```

The UI starts at `http://localhost:5173`.

## Platform Lifecycle

The system operates through seven stages. Each stage builds on the previous one.

### 1. Registration

Administrators register AI services in the Service Registry (Services page). Each record captures the LLM model identifier, owner, and a sensitivity label (Public, Internal, or Confidential). Service data is stored in the `AIService` model with connection history in `ConnectionLog`. Only admin-role users can create, update, or delete services.

### 2. Service Setup

After registration, administrators configure monitoring parameters for each service: evaluation test cases, budget thresholds, and safety scanner sensitivity. The Settings page provides centralized control over daily/monthly budget caps, rate limits, retry behavior (exponential backoff), and input validation rules.

### 3. Monitoring

The platform monitors services in two ways. Scheduled health checks run every 5 minutes (HTTP-only, no Claude API consumption) to track latency, uptime, and error rates. Quality evaluations run synthetic test cases stored in `EvalTestCase`, scoring responses for accuracy and safety. Results are stored in `EvalRun` and `EvalResult` models. The Dashboard page displays P50, P95, and P99 percentiles, throughput, error categorization, and efficiency ratings.

### 4. Safety and Budget

Every prompt passes through the Prompt Safety Scanner before reaching the LLM. The scanner checks for injection attempts (15 patterns), PII (names, emails, phone numbers, SSNs), and length violations. Failed checks raise `PromptSafetyError` (HTTP 422) and the prompt is never forwarded. Budget enforcement caps spending at $5/day and $25/month, with global rate limiting at 10 requests/min and per-user limiting at 5 requests/min. Exceeding limits returns `BudgetExceededError` (HTTP 402 or 429).

### 5. Incident Triage

When drift, latency spikes, or safety anomalies occur, engineers create incident tickets on the Incidents page. The platform offers AI-assisted drafting: Claude reads telemetry data and generates an incident summary or post-mortem, which the engineer must approve or reject before it takes effect (human-in-the-loop). The Maintenance Planner schedules rollbacks or fixes via the `MaintenancePlan` model. The IncidentDetail page provides a deep-dive view of individual incidents.

### 6. Governance

Every state-changing operation (service creation, evaluation run, incident update, role change) is recorded in the `AuditLog` model with an immutable timestamp, acting user, action type, and metadata. The `LoginAttempt` model tracks authentication events, enforcing lockout after 5 failed attempts within 15 minutes. The Governance page lets compliance teams filter and export audit logs as JSON. The DataPolicy page documents data handling and retention policies.

### 7. Settings

The Settings page gives administrators centralized control over budget limits, rate limits, safety scanner sensitivity, retry parameters, and input validation rules. Changes take effect without code modifications or redeployments.

## Key Concepts

### RBAC Roles

| Role | Permissions |
|------|-------------|
| Admin | Full access to all CRUD operations, user management, and configuration |
| Maintainer | Can manage services, incidents, and evaluations; cannot modify users or roles |
| Viewer | Read-only access across all pages |

### Drift Detection

The platform compares current evaluation scores against historical baselines to detect model degradation.

- **Severity:** none, warning, or critical
- **Trend:** improving, declining, or stable
- **Variance:** statistical spread of scores across runs
- **Per-test tracking:** individual test case performance over time via `EvalResult`
- **Percentiles:** P50, P95, P99 for latency and quality metrics
- **Confidence:** low, medium, or high based on sample size

### Human-in-the-Loop

All LLM-generated content (incident summaries, post-mortems, maintenance recommendations) requires explicit human approval before it is saved or acted upon. The platform never auto-executes AI-drafted actions.

### Sensitivity Labels

Each registered service is tagged with a sensitivity label that governs data handling:

- **Public:** No restrictions on data exposure
- **Internal:** Accessible only within the organization
- **Confidential:** Restricted access, subject to additional audit requirements

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| Cmd+K | Open command palette |
| G then D | Jump to Dashboard |
| G then S | Jump to Services |
| G then E | Jump to Evaluations |
| G then I | Jump to Incidents |
| G then G | Jump to Governance |
| G then P | Jump to Data Policy |
| G then T | Jump to Settings |
| Escape | Close modal or command palette |
| Tab / Shift+Tab | Navigate focusable elements (focus traps active in modals) |
