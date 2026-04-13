# AIHealthCheck

A centralized AI operations platform to monitor, evaluate, triage, and govern an organization's AI services.

ARTI-409-A | AI Systems & Governance | Group Project

## Tech Stack

| Layer | Technology |
|-------|------------|
| Frontend | React 18, Vite 5, Tailwind CSS 3.4, Recharts |
| Backend | FastAPI, Python 3.11+ |
| Database | SQLite via SQLAlchemy |
| LLM | Anthropic Claude Sonnet 4.6 (`claude-sonnet-4-6-20250415`) via `anthropic>=0.49.0` SDK |
| Scheduler | APScheduler (health checks every 5 min via HTTP probe) |
| Testing | Pytest (45 tests), React Testing Library |

## Quick Start

### Prerequisites

- Python 3.11+
- Node.js 18+
- Git
- An Anthropic API key

### 1. Clone the repository

```bash
git clone https://github.com/shaqir/ai-health-check.git
cd ai-health-check
```

### 2. Backend setup

```bash
cd backend

# Create and activate virtual environment
python -m venv venv
source venv/bin/activate        # macOS/Linux
# venv\Scripts\activate         # Windows

# Install dependencies
pip install -r requirements.txt

# Configure environment
cp .env.example .env
# Edit .env and add your ANTHROPIC_API_KEY

# Run database migrations
alembic upgrade head

# Seed initial data (users + sample services)
python -m app.seed

# Start the backend server
uvicorn app.main:app --reload --port 8000
```

Backend: http://localhost:8000
API docs: http://localhost:8000/docs

### 3. Frontend setup

```bash
cd frontend

# Install dependencies
npm install

# Start the dev server
npm run dev
```

Frontend: http://localhost:5173

## Default Credentials

| Role | Email | Password |
|------|-------|----------|
| Admin | admin@aiops.local | admin123 |
| Maintainer | maintainer@aiops.local | maintain123 |
| Viewer | viewer@aiops.local | viewer123 |

## Project Structure

```
ai-health-check/
├── backend/                          # 22 Python files
│   ├── app/
│   │   ├── main.py                   # FastAPI app, CORS, startup hooks
│   │   ├── config.py                 # 22 settings via Pydantic BaseSettings
│   │   ├── database.py               # SQLAlchemy engine + session
│   │   ├── seed.py                   # Seed data script
│   │   ├── models/
│   │   │   └── __init__.py           # 12 SQLAlchemy ORM models
│   │   ├── schemas/                  # Pydantic request/response schemas
│   │   ├── routers/                  # 7 routers, 43 endpoints total
│   │   │   ├── auth.py               # Login, register, token management
│   │   │   ├── services.py           # Service registry CRUD
│   │   │   ├── evaluations.py        # Eval harness + drift detection
│   │   │   ├── incidents.py          # Incident triage + LLM summaries
│   │   │   ├── maintenance.py        # Maintenance planner
│   │   │   ├── dashboard.py          # Metrics, telemetry, percentiles
│   │   │   └── compliance.py         # Audit log + governance export
│   │   ├── services/
│   │   │   ├── llm_client.py         # 6 Claude functions via _make_api_call
│   │   │   └── safety.py             # Prompt scanner (injection + PII)
│   │   └── middleware/
│   │       ├── auth.py               # JWT + bcrypt + login throttling
│   │       ├── rbac.py               # admin/maintainer/viewer enforcement
│   │       └── audit.py              # Mutation logging
│   ├── tests/
│   │   ├── conftest.py               # Test fixtures and setup
│   │   ├── test_services.py          # 13 tests
│   │   ├── test_evaluations.py       # 11 tests
│   │   ├── test_dashboard.py         # 9 tests
│   │   ├── test_compliance.py        # 10 tests
│   │   └── test_integration.py       # 2 tests
│   ├── alembic/                      # Database migrations
│   ├── alembic.ini
│   ├── requirements.txt
│   └── .env.example
├── frontend/                         # 22 JSX files
│   ├── src/
│   │   ├── App.jsx                   # Router with protected routes
│   │   ├── main.jsx                  # React entry point
│   │   ├── index.css                 # Tailwind + CSS variable design tokens
│   │   ├── components/
│   │   │   ├── common/               # 13 shared components
│   │   │   │   ├── CommandPalette.jsx
│   │   │   │   ├── DataTable.jsx
│   │   │   │   ├── EmptyState.jsx
│   │   │   │   ├── ErrorState.jsx
│   │   │   │   ├── Kbd.jsx
│   │   │   │   ├── LoadingSkeleton.jsx
│   │   │   │   ├── MetricCard.jsx
│   │   │   │   ├── Modal.jsx
│   │   │   │   ├── PageHeader.jsx
│   │   │   │   ├── Sidebar.jsx
│   │   │   │   ├── StatusBadge.jsx
│   │   │   │   ├── ThemeProvider.jsx
│   │   │   │   └── Toast.jsx
│   │   │   └── evaluations/          # 3 evaluation-specific components
│   │   │       ├── DriftAnalysis.jsx
│   │   │       ├── EvalRunsSection.jsx
│   │   │       └── TestCasesSection.jsx
│   │   ├── pages/                    # 9 pages
│   │   │   ├── LoginPage.jsx
│   │   │   ├── DashboardPage.jsx
│   │   │   ├── ServicesPage.jsx
│   │   │   ├── IncidentsPage.jsx
│   │   │   ├── IncidentDetailPage.jsx
│   │   │   ├── EvaluationsPage.jsx
│   │   │   ├── GovernancePage.jsx
│   │   │   ├── DataPolicyPage.jsx
│   │   │   └── SettingsPage.jsx
│   │   ├── context/
│   │   │   └── AuthContext.jsx       # Auth state + RBAC flags
│   │   └── utils/
│   │       └── api.js                # Axios instance with JWT interceptor
│   ├── index.html
│   ├── package.json
│   ├── vite.config.js
│   └── tailwind.config.js
├── docs/
│   ├── ARCHITECTURE.md
│   ├── ONBOARDING.md
│   ├── TESTING_STRATEGY.md
│   ├── ROADMAP.md
│   ├── PROMPT_CHANGE_LOG.md
│   ├── RISK_REGISTER.md
│   ├── EVAL_DATASET_CARD.md
│   └── MAINTENANCE_RUNBOOK.md
├── .gitignore
└── README.md
```

## Core Modules

| Module | Owner | Description |
|--------|-------|-------------|
| M1: Service Registry | Jack | Service catalog with CRUD operations, health check scheduling via APScheduler (HTTP probe every 5 min), connection testing, and status tracking |
| M2: Monitoring and Evaluation | Sakir | Dashboard metrics with P50/P95/P99 percentiles, evaluation harness with per-test-case drift detection, severity classification, and trend analysis |
| M3: Incident Triage | Osele | Incident lifecycle management with severity classification, LLM-generated summaries, maintenance planning, and rollback procedures |
| M4: Governance | Jeewanjot | Immutable audit logging of all mutations, compliance report generation, data classification policies, and governance exports |

## Advanced Features

### Prompt Safety Scanner

All LLM inputs pass through `safety.py` before reaching the Anthropic API:

- 15 regex patterns detecting injection attacks (role overrides, delimiter exploitation, instruction overrides, encoding attacks)
- PII detection for email addresses, phone numbers, SSNs, and credit card numbers
- Prompt length enforcement (max 10,000 characters)
- Risk scoring from 0 to 100 aggregated across all detected patterns
- Output scanning on LLM responses before they are returned to callers
- Raises `PromptSafetyError` (HTTP 422) when thresholds are exceeded

### API Budget Enforcement

- Daily budget cap: $5.00, tracked via `APIUsageLog` with date filtering
- Monthly budget cap: $25.00, tracked via `APIUsageLog` with month filtering
- Per-call cost tracking with token usage logging (input + output)
- Global rate limit: 10 API calls per minute
- Per-user rate limit: 5 API calls per minute
- Raises `BudgetExceededError` (HTTP 402 or 429) when limits are hit

### Advanced Drift Detection

- Per-test-case tracking via `EvalResult` with variance calculation
- Severity classification: `none`, `warning`, `critical` (configurable threshold, default 75.0)
- Trend analysis: `improving`, `declining`, `stable` based on historical eval runs
- Statistical metrics: P50, P95, P99 percentiles across test case scores
- Confidence scoring: `low` (fewer than 3 runs), `medium` (3-9 runs), `high` (10+ runs)

### Error Handling and Resilience

- Retry with exponential backoff (2 retries for transient errors: timeouts, 429s, 5xx)
- Timeout enforcement at 30 seconds per LLM call
- Login throttling: 5 failed attempts triggers a 15-minute lockout
- All pages implement loading, empty, and error states in the frontend

### Accessibility and Design

- WCAG 2.2 AA compliant with full ARIA roles, focus traps, and screen reader support
- Dark and light themes via CSS variable design tokens
- Inter and JetBrains Mono font pairing with semantic color tokens
- Command palette (Cmd+K) with keyboard navigation (G+D/S/I/E jump, ? help, Escape close)
- Complete tab/focus order with skip-to-main link

## API Endpoints

43 endpoints across 7 routers:

| Router | Prefix | Description |
|--------|--------|-------------|
| `auth.py` | `/api/auth` | Login, registration, token management |
| `services.py` | `/api/services` | Service registry CRUD, connection testing, health checks |
| `evaluations.py` | `/api/evaluations` | Eval harness, drift detection, test case management |
| `incidents.py` | `/api/incidents` | Incident CRUD, severity classification, LLM triage |
| `maintenance.py` | `/api/maintenance` | Maintenance plan scheduling, rollback procedures |
| `dashboard.py` | `/api/dashboard` | Aggregated metrics, percentiles, telemetry, LLM insights |
| `compliance.py` | `/api/compliance` | Audit log queries, governance exports, compliance summaries |

## Configuration

Key settings managed via `.env` and `config.py` (22 total):

| Setting | Default | Description |
|---------|---------|-------------|
| `anthropic_api_key` | (required) | Anthropic API key |
| `llm_model` | `claude-sonnet-4-6-20250415` | Claude model identifier |
| `llm_max_tokens` | 1024 | Max tokens per LLM call |
| `llm_timeout_seconds` | 30 | LLM call timeout in seconds |
| `drift_threshold` | 75.0 | Drift severity threshold |
| `api_daily_budget` | 5.0 | Daily API spend cap (USD) |
| `api_monthly_budget` | 25.0 | Monthly API spend cap (USD) |
| `api_max_calls_per_minute` | 10 | Global rate limit |
| `api_max_calls_per_user_per_minute` | 5 | Per-user rate limit |
| `max_prompt_length` | 10000 | Max input prompt characters |
| `max_login_attempts` | 5 | Failed logins before lockout |
| `login_lockout_minutes` | 15 | Lockout duration in minutes |

## Database Models

12 SQLAlchemy models defined in `models/__init__.py`:

| Model | Table | Purpose |
|-------|-------|---------|
| `User` | `users` | Identity, RBAC roles, bcrypt-hashed credentials |
| `AIService` | `ai_services` | Service registry with endpoints, owners, model tags |
| `ConnectionLog` | `connection_logs` | Health check connection history per service |
| `EvalTestCase` | `eval_test_cases` | Evaluation dataset definitions |
| `EvalRun` | `eval_runs` | Evaluation execution records with aggregate scores |
| `EvalResult` | `eval_results` | Per-test-case results with drift tracking |
| `Incident` | `incidents` | Incident records with severity and status |
| `MaintenancePlan` | `maintenance_plans` | Scheduled maintenance and rollback plans |
| `AuditLog` | `audit_logs` | Immutable compliance audit trail |
| `Telemetry` | `telemetry` | Service latency and performance telemetry |
| `APIUsageLog` | `api_usage_logs` | LLM API cost and usage tracking |
| `LoginAttempt` | `login_attempts` | Failed login tracking for throttling |

## Testing

```bash
# Run all backend tests (45 tests)
cd backend
pytest -v

# Individual test modules
pytest tests/test_services.py -v      # 13 tests
pytest tests/test_evaluations.py -v   # 11 tests
pytest tests/test_dashboard.py -v     #  9 tests
pytest tests/test_compliance.py -v    # 10 tests
pytest tests/test_integration.py -v   #  2 tests

# Frontend tests
cd frontend
npm test
```

## Documentation

| Document | Description |
|----------|-------------|
| [ARCHITECTURE.md](docs/ARCHITECTURE.md) | System architecture and technical design |
| [ONBOARDING.md](docs/ONBOARDING.md) | Developer onboarding guide |
| [TESTING_STRATEGY.md](docs/TESTING_STRATEGY.md) | Testing approach and coverage details |
| [ROADMAP.md](docs/ROADMAP.md) | Project roadmap and milestones |
| [PROMPT_CHANGE_LOG.md](docs/PROMPT_CHANGE_LOG.md) | LLM prompt iteration history |
| [RISK_REGISTER.md](docs/RISK_REGISTER.md) | Identified risks and mitigations |
| [EVAL_DATASET_CARD.md](docs/EVAL_DATASET_CARD.md) | Evaluation dataset documentation |
| [MAINTENANCE_RUNBOOK.md](docs/MAINTENANCE_RUNBOOK.md) | Operational maintenance procedures |

## Team

| Member | Module | Focus Area |
|--------|--------|------------|
| Jack | M1: Service Registry | Service catalog, backend core, health check scheduling |
| Sakir | M2: Monitoring and Evaluation | Dashboard metrics, eval harness, drift detection |
| Osele | M3: Incident Triage | Incident lifecycle, LLM integration, maintenance planning |
| Jeewanjot | M4: Governance | Audit logging, compliance, documentation |

---

Academic project -- ARTI-409-A, AI Systems & Governance, 2026
