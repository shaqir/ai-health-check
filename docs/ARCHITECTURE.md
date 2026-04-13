# AIHealthCheck -- Architecture Document

## 1. Overview

AIHealthCheck is an AI operations control room built for the ARTI-409-A (AI Systems & Governance) course. It provides a centralized platform to monitor, evaluate, triage, and govern an organization's AI services and LLM deployments.

### Stack Rationale

The project uses a decoupled client-server architecture selected for academic portability and development velocity:

- **React 18 + Vite 5 + Tailwind 3.4** (Option B from the project outline): Vite provides fast HMR during development, Tailwind enables rapid UI iteration with utility classes, and React 18 offers mature component patterns with concurrent rendering support.
- **FastAPI + SQLAlchemy + SQLite**: FastAPI delivers automatic OpenAPI documentation and async support. SQLAlchemy provides a robust ORM layer. SQLite removes external database dependencies, making the project runnable on any machine with Python installed.
- **Anthropic Claude Sonnet 4.6** (`claude-sonnet-4-6-20250415`, SDK `>=0.49.0`): Selected as the LLM inference provider for evaluation scoring, incident summarization, dashboard insights, and compliance report generation.

## 2. System Architecture

The system follows a strict client-server separation with four layers:

```
Frontend (React SPA)
    |
    | HTTP/JSON (JWT bearer tokens)
    |
Backend (FastAPI)
    |
    |--- SQLite (SQLAlchemy ORM, 12 models)
    |
    |--- Anthropic API (Claude Sonnet 4.6)
    |        ^
    |        |-- Safety scan (input)
    |        |-- Budget check
    |        |-- Rate limit check
    |        |-- Retry with backoff
    |        |-- Safety scan (output)
    |        |-- Usage logging
    |
    |--- APScheduler (health checks every 5 min, HTTP probe)
```

- **Frontend to Backend**: All communication uses JSON over HTTP. The frontend attaches JWT bearer tokens via an Axios interceptor. CORS is configured to allow `http://localhost:5173`.
- **Backend to Database**: SQLAlchemy manages all database operations. Alembic handles schema migrations.
- **Backend to Claude API**: All LLM calls route through a centralized `_make_api_call` pipeline in `llm_client.py` with safety scanning, budget enforcement, rate limiting, retry logic, and usage logging.
- **Background Scheduler**: APScheduler runs health checks every 5 minutes using HTTP probes (not Claude API calls).

## 3. Backend Layer

The backend consists of 22 Python files organized into routers, middleware, services, models, and schemas.

### Application Entry Points

- **`main.py`**: Loads ASGI middleware (CORS, exception handlers), registers the 7 router groups, and bootstraps APScheduler on startup.
- **`config.py`**: Centralized settings via Pydantic `BaseSettings` with 22 configurable parameters covering LLM configuration, budgets, rate limits, security thresholds, and scheduling intervals.
- **`database.py`**: SQLAlchemy engine and session factory targeting `sqlite:///./aiops.db`.
- **`seed.py`**: Creates default users (admin, maintainer, viewer) and sample service data.

### Routers (7 routers, 43 endpoints)

| Router | Prefix | Responsibility |
|--------|--------|----------------|
| `auth.py` | `/api/auth` | Login, registration, token management, login throttling |
| `services.py` | `/api/services` | Service registry CRUD, connection testing, health checks |
| `evaluations.py` | `/api/evaluations` | Eval harness execution, drift detection, test case management |
| `incidents.py` | `/api/incidents` | Incident CRUD, severity classification, LLM triage summaries |
| `maintenance.py` | `/api/maintenance` | Maintenance plan scheduling, rollback procedures |
| `dashboard.py` | `/api/dashboard` | Aggregated metrics, performance percentiles, telemetry, LLM insights |
| `compliance.py` | `/api/compliance` | Audit log queries, governance exports, compliance summaries |

### Middleware (3 modules)

| Module | Function |
|--------|----------|
| `auth.py` | JWT verification using HS256-signed tokens. Passwords hashed with bcrypt. Login throttling tracks failed attempts in `LoginAttempt` and locks accounts after 5 failures within 15 minutes. |
| `rbac.py` | Role-based access control enforced via FastAPI `Depends()`. Three roles: `admin` (full access), `maintainer` (read-write on assigned resources), `viewer` (read-only). |
| `audit.py` | Automatic logging of all state-changing operations (POST, PUT, DELETE) to the `AuditLog` table with user attribution, timestamp, endpoint, and action details. |

### Services (2 modules)

| Module | Function |
|--------|----------|
| `llm_client.py` | Centralized LLM client with 6 Claude functions routed through `_make_api_call`. Handles safety scanning, budget enforcement, rate limiting, retry logic, and usage logging. |
| `safety.py` | Prompt safety scanner with 15 injection patterns, PII detection, length limits, and risk scoring. |

## 4. LLM Client Architecture

All Anthropic API interactions are centralized in `llm_client.py`. The module exposes 6 functions, each of which delegates to the shared `_make_api_call` pipeline.

### The `_make_api_call` Pipeline

Every LLM request passes through 6 stages in order:

```
Caller
  |
  v
[1] Input Safety Scan
  |  Prompt passed to safety.py for injection pattern matching,
  |  PII detection, and length validation. Raises PromptSafetyError
  |  (HTTP 422) if risk score exceeds threshold.
  v
[2] Budget Check
  |  Queries APIUsageLog for current daily and monthly spend.
  |  Raises BudgetExceededError (HTTP 402) if either budget
  |  ceiling would be exceeded.
  v
[3] Rate Limit Check
  |  Enforces global limit (10/min) and per-user limit (5/min).
  |  Rejects with HTTP 429 if exceeded.
  v
[4] API Call with Retry
  |  Executes the Anthropic SDK call with exponential backoff.
  |  2 retries for transient errors (timeouts, 429s, 5xx).
  |  Timeout enforced at 30 seconds.
  v
[5] Output Safety Scan
  |  LLM response text scanned before returning to caller.
  v
[6] Usage Logging
  |  Token usage (input + output) and estimated cost recorded
  |  to APIUsageLog for budget accounting.
  v
Caller receives response
```

### LLM Functions

| Function | Purpose |
|----------|---------|
| `test_connection` | Verify Anthropic API connectivity and model availability |
| `run_eval_prompt` | Execute evaluation prompts against registered AI services |
| `score_factuality` | Score the factual accuracy of LLM-generated output |
| `generate_summary` | Generate narrative summaries for incidents |
| `generate_dashboard_insight` | Produce dashboard-level narrative insights from aggregated metrics |
| `generate_compliance_summary` | Generate governance and compliance summary reports |

## 5. Safety and Budget Enforcement

### Prompt Safety Scanner (`services/safety.py`)

The scanner runs on all LLM inputs and outputs with four detection layers:

**Injection Detection**: 15 regex patterns covering common prompt injection techniques:
- Role-override attempts (e.g., "ignore previous instructions")
- Delimiter exploitation
- Instruction overrides and system prompt extraction
- Encoding-based attacks

**PII Detection**: Pattern matchers for four categories:
- Email addresses
- Phone numbers
- Social Security Numbers (SSNs)
- Credit card numbers

Detected PII is blocked before reaching the Anthropic API.

**Length Enforcement**: Prompts exceeding `max_prompt_length` (default: 10,000 characters) are rejected.

**Risk Scoring**: Each prompt receives a numeric score from 0 to 100 aggregated from all detected patterns. The score determines whether the prompt is allowed, flagged, or blocked. A `PromptSafetyError` is raised with a descriptive message when a prompt fails.

### Budget Limits

| Limit | Value | Tracking |
|-------|-------|----------|
| Daily budget | $5.00 | `APIUsageLog` entries filtered by date |
| Monthly budget | $25.00 | `APIUsageLog` entries filtered by month |
| Per-call tracking | Token count + estimated cost | Logged after each successful API call |

Raises `BudgetExceededError` when a call would exceed either ceiling.

### Rate Limits

| Limit | Value |
|-------|-------|
| Global | 10 API calls per minute across all users |
| Per-user | 5 API calls per minute per authenticated user |

Both limits are enforced within `_make_api_call`, so no LLM endpoint can bypass rate controls.

### Error Codes

| Error | HTTP Status | Trigger |
|-------|-------------|---------|
| `PromptSafetyError` | 422 | Input fails safety scan (injection, PII, length) |
| `BudgetExceededError` | 402 | Daily or monthly budget would be exceeded |
| Rate limit exceeded | 429 | Global or per-user rate limit hit |

## 6. Database Layer

Data persistence uses SQLite (`aiops.db`) via SQLAlchemy 2.0+ with Alembic migrations for schema versioning.

### Complete Model Inventory (12 models)

| Model | Table | Purpose |
|-------|-------|---------|
| `User` | `users` | Identity, RBAC role enum (`admin`, `maintainer`, `viewer`), bcrypt-hashed password |
| `AIService` | `ai_services` | Service registry: endpoint URLs, owner namespaces, model tags, status |
| `ConnectionLog` | `connection_logs` | Health check connection history per service (latency, status, errors) |
| `EvalTestCase` | `eval_test_cases` | Evaluation dataset definitions: input prompts, expected outputs, categories |
| `EvalRun` | `eval_runs` | Evaluation execution records: timestamps, aggregate scores, drift status |
| `EvalResult` | `eval_results` | Per-test-case evaluation results: individual scores, variance, drift tracking |
| `Incident` | `incidents` | Incident records: severity, status, symptoms, LLM-generated summaries |
| `MaintenancePlan` | `maintenance_plans` | Scheduled maintenance: action items, rollback procedures, timelines |
| `AuditLog` | `audit_logs` | Immutable compliance audit trail: all POST/PUT/DELETE operations with user attribution |
| `Telemetry` | `telemetry` | Service performance telemetry: latency samples, error counts, timestamps |
| `APIUsageLog` | `api_usage_logs` | LLM API cost tracking: tokens consumed, estimated cost, user attribution |
| `LoginAttempt` | `login_attempts` | Failed login tracking: user identifier, timestamp, used for throttling enforcement |

## 7. Advanced Drift Detection

The evaluation harness implements multi-dimensional drift detection that goes beyond simple threshold comparisons.

### Per-Test-Case Tracking

Each evaluation run produces individual `EvalResult` records linked to specific `EvalTestCase` entries. This enables identifying which specific test cases are degrading rather than relying solely on aggregate scores.

### Severity Classification

Drift severity is determined by comparing the current aggregate score against `drift_threshold` (default: 75.0):

| Level | Condition |
|-------|-----------|
| `none` | Score above threshold with no significant variance |
| `warning` | Score approaching threshold or elevated variance across test cases |
| `critical` | Score below threshold |

### Trend Analysis

Historical `EvalRun` records are analyzed to classify the trajectory:

| Trend | Meaning |
|-------|---------|
| `improving` | Recent scores show consistent upward movement |
| `declining` | Recent scores show consistent downward movement |
| `stable` | Scores remain within normal variance bounds |

### Statistical Metrics

- **Percentiles**: P50, P95, and P99 computed across individual test case scores within each run.
- **Variance**: Standard deviation across test case results quantifies score consistency.
- **Confidence Scoring**: Based on historical data volume -- `low` (fewer than 3 runs), `medium` (3-9 runs), `high` (10+ runs).

## 8. Frontend Layer

The frontend consists of 22 JSX files organized into pages, common components, and evaluation-specific components.

### Pages (9)

| Page | File | Purpose |
|------|------|---------|
| Login | `LoginPage.jsx` | Authentication with credential entry |
| Dashboard | `DashboardPage.jsx` | Fleet-wide metrics, performance percentiles, LLM-generated insights |
| Services | `ServicesPage.jsx` | Service registry CRUD, connection testing, health status |
| Incidents | `IncidentsPage.jsx` | Incident listing with severity and status filtering |
| Incident Detail | `IncidentDetailPage.jsx` | Individual incident deep-dive with LLM-generated summaries |
| Evaluations | `EvaluationsPage.jsx` | Eval harness execution, results display, drift visualization |
| Governance | `GovernancePage.jsx` | Audit log viewer, compliance report generation |
| Data Policy | `DataPolicyPage.jsx` | Data classification and handling policy reference |
| Settings | `SettingsPage.jsx` | API configuration, model settings, budget monitoring |

All pages implement loading, empty, and error states.

### Common Components (13)

| Component | Purpose |
|-----------|---------|
| `CommandPalette` | Cmd+K command palette for quick navigation and actions |
| `DataTable` | Reusable sortable/filterable data table |
| `EmptyState` | Placeholder display when no data is available |
| `ErrorState` | Error display with retry actions |
| `Kbd` | Keyboard shortcut badge rendering |
| `LoadingSkeleton` | Shimmer loading placeholder |
| `MetricCard` | Numeric metric display with labels and trends |
| `Modal` | Accessible modal dialog with focus trap |
| `PageHeader` | Consistent page title and action bar |
| `Sidebar` | Navigation sidebar with active state indicators |
| `StatusBadge` | Color-coded status indicator |
| `ThemeProvider` | Dark/light theme context with CSS variable toggling |
| `Toast` | Notification toast system |

### Evaluations Components (3)

| Component | Purpose |
|-----------|---------|
| `DriftAnalysis` | Drift visualization with severity indicators and trend charts |
| `EvalRunsSection` | Evaluation run history listing |
| `TestCasesSection` | Test case management interface |

### Design System

- **CSS Variable Tokens**: Semantic color tokens defined as CSS custom properties, enabling theme switching without class changes.
- **Themes**: Dark and light modes toggled via `ThemeProvider`. Token values swap between themes.
- **Typography**: Inter for body text, JetBrains Mono for code and metrics.
- **Accessibility**: WCAG 2.2 AA compliant with ARIA roles, focus traps, keyboard navigation, and screen reader support. Includes a skip-to-main link and complete tab/focus order.

### Keyboard Navigation

| Shortcut | Action |
|----------|--------|
| Cmd+K | Open command palette |
| G then D | Jump to Dashboard |
| G then S | Jump to Services |
| G then I | Jump to Incidents |
| G then E | Jump to Evaluations |
| ? | Open help |
| Escape | Close modal/palette |

## 9. Security

### Authentication

- **JWT Tokens**: OAuth2-compliant access tokens signed with HS256. Expiration configurable via `access_token_expire_minutes` (default: 30).
- **Password Hashing**: All passwords hashed with bcrypt before storage.

### Role-Based Access Control

Three roles enforced via FastAPI dependency injection:

| Role | Access Level |
|------|-------------|
| `admin` | Full read-write access to all resources |
| `maintainer` | Read-write on assigned resources |
| `viewer` | Read-only access |

### Login Throttling

- Each failed login is recorded in `LoginAttempt` with user identifier and timestamp.
- After 5 failed attempts within 15 minutes, the account is temporarily locked.
- Subsequent login attempts are rejected until the lockout window expires.

### Input Validation and Sanitization

- `max_length` constraints on user-supplied text fields (prompts, symptoms, descriptions).
- All text destined for the LLM passes through the safety scanner.
- Pydantic models enforce type constraints and required field checks on all endpoints.

### Retry with Exponential Backoff

Transient failures from the Anthropic API (timeouts, 429 rate limit responses, 5xx server errors) trigger automatic retry with exponential backoff (2 retries). This prevents cascading failures while respecting upstream rate limits.

## 10. Testing

The backend test suite contains 45 tests across 5 modules:

| Module | Tests | Coverage Focus |
|--------|-------|----------------|
| `test_services.py` | 13 | Service registry CRUD, connection testing, validation |
| `test_evaluations.py` | 11 | Eval harness execution, drift detection, result tracking |
| `test_dashboard.py` | 9 | Metric aggregation, performance percentiles, telemetry |
| `test_compliance.py` | 10 | Audit log queries, compliance exports, governance |
| `test_integration.py` | 2 | End-to-end workflow validation across modules |

**Test Infrastructure**: A shared `conftest.py` provides an isolated SQLite test database, pre-seeded users across all three roles, and mocked LLM client responses to avoid hitting the Anthropic API during tests.

## 11. Configuration Reference

All 22 settings are managed through environment variables loaded by Pydantic `BaseSettings` in `config.py`:

| Setting | Default | Category |
|---------|---------|----------|
| `anthropic_api_key` | (required) | LLM |
| `llm_model` | `claude-sonnet-4-6-20250415` | LLM |
| `llm_max_tokens` | 1024 | LLM |
| `llm_timeout_seconds` | 30 | LLM |
| `database_url` | `sqlite:///./aiops.db` | Database |
| `secret_key` | (required) | Security |
| `algorithm` | `HS256` | Security |
| `access_token_expire_minutes` | 30 | Security |
| `max_login_attempts` | 5 | Security |
| `login_lockout_minutes` | 15 | Security |
| `max_prompt_length` | 10000 | Safety |
| `drift_threshold` | 75.0 | Evaluation |
| `api_daily_budget` | 5.0 | Budget |
| `api_monthly_budget` | 25.0 | Budget |
| `api_max_calls_per_minute` | 10 | Rate Limiting |
| `api_max_calls_per_user_per_minute` | 5 | Rate Limiting |
| `eval_schedule_minutes` | 60 | Scheduling |
| `health_check_schedule_minutes` | 5 | Scheduling |
| `app_name` | `AIHealthCheck` | Application |
| `debug` | `false` | Application |
| `cors_origins` | `["http://localhost:5173"]` | Application |
| `log_level` | `info` | Application |
