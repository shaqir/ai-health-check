# AIHealthCheck -- Architecture Document

## 1. System Overview

AIHealthCheck is a centralized AI operations platform built for the ARTI-409-A course. The frontend is a React 18 SPA (Vite 5 + Tailwind 3.4). The backend is FastAPI with SQLAlchemy ORM over SQLite. All LLM calls use Anthropic Claude Sonnet 4.6 (`claude-sonnet-4-6-20250415`) via the `anthropic>=0.49.0` SDK, routed through a single pipeline in `llm_client.py`. Background health checks run via APScheduler (HTTP probe every 5 min).

## 2. Architecture Diagram

```
User (Browser)
    |
    |  HTTP/JSON + JWT bearer token
    v
React SPA (Vite 5 + Tailwind 3.4)
    |
    |  Axios + JWT interceptor
    v
FastAPI Backend (7 routers, 43 endpoints)
    |
    |--- SQLite (SQLAlchemy ORM, 12 models, Alembic migrations)
    |
    |--- Anthropic API (Claude Sonnet 4.6)
    |        ^
    |        |-- [1] Input safety scan
    |        |-- [2] Budget check
    |        |-- [3] Rate limit check
    |        |-- [4] Retry with backoff
    |        |-- [5] Output safety scan
    |        |-- [6] Usage logging
    |
    |--- APScheduler (health checks every 5 min, HTTP probe)
```

## 3. Backend

22 Python files organized into routers, middleware, services, models, and schemas.

### Application Entry Points

| File | Purpose |
|------|---------|
| `main.py` | ASGI middleware (CORS, exception handlers), 7 router groups, APScheduler bootstrap |
| `config.py` | 22 settings via Pydantic `BaseSettings` ([see Configuration Reference](#11-configuration-reference)) |
| `database.py` | SQLAlchemy engine + session factory targeting `sqlite:///./aiops.db` |
| `seed.py` | Creates default users (admin, maintainer, viewer) and sample services |

### Routers (7 routers, 43 endpoints)

| Router | Prefix | Endpoints | Responsibility |
|--------|--------|-----------|----------------|
| `auth.py` | `/api/v1/auth` | 3 | Login, registration, current user info |
| `services.py` | `/api/v1/services` | 6 | Service registry CRUD, connection testing (HTTP + LLM modes) |
| `evaluations.py` | `/api/v1/evaluations` | 10 | Test case CRUD, eval run execution, cost preview, drift check, drift trend |
| `incidents.py` | `/api/v1/incidents` | 4 | Incident CRUD, LLM summary generation, human-in-the-loop approval |
| `maintenance.py` | `/api/v1/maintenance` | 3 | Maintenance plan CRUD, admin approval |
| `dashboard.py` | `/api/v1/dashboard` | 12 | Metrics, latency/quality/error trends, drift alerts, AI summary, API usage, performance, safety stats |
| `compliance.py` | `/api/v1/compliance` | 5 | Audit log queries, user management, JSON/PDF export, AI compliance report |

### Middleware (3 modules)

| Module | Purpose |
|--------|---------|
| `auth.py` | JWT verification (HS256), bcrypt password hashing, login throttling |
| `rbac.py` | Role-based access control via `Depends()`: admin, maintainer, viewer |
| `audit.py` | Automatic logging of POST/PUT/DELETE to `AuditLog` with user attribution |

### Services (2 modules)

| Module | Purpose |
|--------|---------|
| `llm_client.py` | 6 Claude functions routed through `_make_api_call` pipeline |
| `safety.py` | Prompt scanner: 15 injection patterns, PII detection, length limits, risk scoring |

## 4. LLM Client Pipeline

All Anthropic API calls are centralized in `llm_client.py`. The 6 public functions each delegate to `_make_api_call`.

### `_make_api_call` Flow (6 stages)

```
[1] Input Safety Scan   -> scan_input() from safety.py. Raises PromptSafetyError (422) if risk >= 80.
[2] Budget Check         -> _check_budget() queries APIUsageLog. Raises BudgetExceededError (402).
[3] Rate Limit Check     -> Same function. Global 10/min, per-user 5/min. Raises HTTP 429.
[4] API Call with Retry  -> client.messages.create() with exponential backoff. 2 retries for timeouts/429s/5xx.
[5] Output Safety Scan   -> scan_output() checks response for PII leakage and refusal patterns.
[6] Usage Logging        -> Token counts + estimated cost written to APIUsageLog.
```

### LLM Function Signatures

| Function | Caller String | Module | Max Tokens | Purpose |
|----------|--------------|--------|------------|---------|
| `test_connection(prompt, model)` | `test_connection` | M1 | 50 | Verify API connectivity and latency |
| `run_eval_prompt(prompt, system_context)` | `run_eval_prompt` | M2 | 1024 | Execute eval test case, return raw response |
| `score_factuality(expected, actual)` | `score_factuality` | M2 | 10 | Rate factual similarity 0-100 (LLM-as-judge) |
| `generate_summary(service_name, severity, symptoms, checklist)` | `generate_summary` | M3 | 1024 | Draft stakeholder update + root causes |
| `generate_dashboard_insight(metrics)` | `generate_dashboard_insight` | M2 | 1024 | Summarize platform health + action items |
| `generate_compliance_summary(audit_data, incidents_data, drift_data)` | `generate_compliance_summary` | M4 | 1024 | Generate governance compliance report |

Full prompt templates are documented in [PROMPT_CHANGE_LOG](PROMPT_CHANGE_LOG.md).

## 5. Database Models (12 models)

This is the canonical model inventory. All models are defined in `backend/app/models/__init__.py`.

| Model | Table | Purpose |
|-------|-------|---------|
| `User` | `users` | Identity, RBAC role enum (admin/maintainer/viewer), bcrypt-hashed password |
| `AIService` | `ai_services` | Service registry: endpoint URLs, owner, model tags, environment, sensitivity label |
| `ConnectionLog` | `connection_logs` | Health check history per service: latency, status, response snippet |
| `EvalTestCase` | `eval_test_cases` | Evaluation dataset: input prompts, expected outputs, categories |
| `EvalRun` | `eval_runs` | Evaluation execution records: aggregate scores, drift status, run type |
| `EvalResult` | `eval_results` | Per-test-case results: individual scores, variance, latency, drift tracking |
| `Incident` | `incidents` | Incident records: severity, status, symptoms, checklist, LLM summary draft/approved |
| `MaintenancePlan` | `maintenance_plans` | Maintenance actions: rollback plan, validation steps, approval status |
| `AuditLog` | `audit_logs` | Immutable compliance trail: all POST/PUT/DELETE with user attribution |
| `Telemetry` | `telemetry` | Service performance telemetry: metric name, value, timestamp |
| `APIUsageLog` | `api_usage_logs` | LLM cost tracking: tokens, cost, latency, status, safety flags, risk score |
| `LoginAttempt` | `login_attempts` | Failed login tracking: email, timestamp, IP address, used for throttling |

## 6. Frontend

22 JSX files organized into pages, common components, and evaluation-specific components.

### Pages (9)

| Page | File | Purpose |
|------|------|---------|
| Login | `LoginPage.jsx` | Credential entry and authentication |
| Dashboard | `DashboardPage.jsx` | Fleet-wide metrics, percentiles, LLM-generated insights |
| Services | `ServicesPage.jsx` | Service registry CRUD, connection testing, health status |
| Incidents | `IncidentsPage.jsx` | Incident listing with severity and status filtering |
| Incident Detail | `IncidentDetailPage.jsx` | Deep-dive view with LLM-generated summaries |
| Evaluations | `EvaluationsPage.jsx` | Eval harness execution, results, drift visualization |
| Governance | `GovernancePage.jsx` | Audit log viewer, compliance report generation |
| Data Policy | `DataPolicyPage.jsx` | Data classification and handling policy reference |
| Settings | `SettingsPage.jsx` | API configuration, model settings, budget monitoring |

All pages implement loading, empty, and error states.

### Common Components (13)

| Component | Purpose |
|-----------|---------|
| `CommandPalette` | Cmd+K quick navigation and actions |
| `DataTable` | Sortable/filterable data table |
| `EmptyState` | Placeholder when no data available |
| `ErrorState` | Error display with retry actions |
| `Kbd` | Keyboard shortcut badge |
| `LoadingSkeleton` | Shimmer loading placeholder |
| `MetricCard` | Numeric metric display with trends |
| `Modal` | Accessible dialog with focus trap |
| `PageHeader` | Page title and action bar |
| `Sidebar` | Navigation with active state indicators |
| `StatusBadge` | Color-coded status indicator |
| `ThemeProvider` | Dark/light theme context with CSS variable toggling |
| `Toast` | Notification toast system |

### Evaluation Components (3)

| Component | Purpose |
|-----------|---------|
| `DriftAnalysis` | Drift visualization with severity indicators and trend charts |
| `EvalRunsSection` | Evaluation run history listing |
| `TestCasesSection` | Test case management interface |

### Design System

- CSS variable design tokens for semantic colors, enabling theme switching without class changes
- Dark and light modes via `ThemeProvider`
- Typography: Inter (body), JetBrains Mono (code/metrics)
- WCAG 2.2 AA: ARIA roles, focus traps, keyboard navigation, screen reader support, skip-to-main link

### Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| Cmd+K | Open command palette |
| G then D | Dashboard |
| G then S | Services |
| G then I | Incidents |
| G then E | Evaluations |
| ? | Help |
| Escape | Close modal/palette |

## 7. Security

### Authentication

- JWT tokens signed with HS256, expiration configurable via `access_token_expire_minutes` (default: 480)
- Passwords hashed with bcrypt before storage

### RBAC

| Role | Access |
|------|--------|
| `admin` | Full read-write on all resources, user management |
| `maintainer` | Read-write on services, incidents, evaluations, maintenance |
| `viewer` | Read-only |

### Login Throttling

- Failed logins recorded in `LoginAttempt` with email, timestamp, IP address
- 5 failed attempts within 15 minutes triggers temporary account lockout

### Input Validation

- `max_length` constraints on user-supplied text fields
- All LLM-bound text passes through the safety scanner
- Pydantic models enforce type constraints and required fields on all endpoints

### Retry with Exponential Backoff

- 2 retries for transient Anthropic errors (timeouts, 429, 5xx)
- Backoff formula: `2^attempt + random(0, 0.5)` seconds
- Non-retryable errors (AuthenticationError, BadRequestError) fail immediately

## 8. Configuration Reference (22 settings)

This is the canonical settings table. All settings are in `backend/app/config.py`, loaded from `.env` via Pydantic `BaseSettings`.

| Setting | Default | Category |
|---------|---------|----------|
| `anthropic_api_key` | (required) | LLM |
| `llm_model` | `claude-sonnet-4-6-20250415` | LLM |
| `llm_max_tokens` | 1024 | LLM |
| `llm_timeout_seconds` | 30 | LLM |
| `database_url` | `sqlite:///./aiops.db` | Database |
| `secret_key` | `change-me-in-production` | Security |
| `algorithm` | `HS256` | Security |
| `access_token_expire_minutes` | 480 | Security |
| `max_login_attempts` | 5 | Security |
| `login_lockout_minutes` | 15 | Security |
| `max_prompt_length` | 10000 | Safety |
| `drift_threshold` | 75.0 | Evaluation |
| `eval_schedule_minutes` | 60 | Scheduling |
| `health_check_schedule_minutes` | 5 | Scheduling |
| `api_daily_budget` | 5.0 | Budget |
| `api_monthly_budget` | 25.0 | Budget |
| `api_max_calls_per_minute` | 10 | Rate Limiting |
| `api_max_calls_per_user_per_minute` | 5 | Rate Limiting |
| `app_name` | `AIHealthCheck` | Application |
| `debug` | `true` | Application |
| `cors_origins` | `http://localhost:5173,http://localhost:3000` | Application |
| `log_level` | `info` | Application |

For testing details, see [TESTING_STRATEGY](TESTING_STRATEGY.md). For drift detection algorithm, see [EVAL_DATASET_CARD](EVAL_DATASET_CARD.md). For prompt templates, see [PROMPT_CHANGE_LOG](PROMPT_CHANGE_LOG.md). For onboarding steps, see [ONBOARDING](ONBOARDING.md).
