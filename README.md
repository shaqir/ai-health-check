# AIHealthCheck

A centralized AI operations platform to monitor, evaluate, triage, and govern an organization's AI services.

ARTI-409-A | AI Systems & Governance | Group Project

## Tech Stack

| Layer | Technology |
|-------|------------|
| Frontend | React 18, Vite 5, Tailwind CSS 3.4, Recharts |
| Backend | FastAPI, Python 3.11+, SQLAlchemy |
| Database | SQLite (via Alembic migrations) |
| LLM | Anthropic Claude Sonnet 4.6 (`claude-sonnet-4-6-20250415`) via `anthropic>=0.49.0` SDK |
| Testing | Pytest (45 backend tests), React Testing Library |

## Quick Start

```bash
# Backend
cd backend && python -m venv venv && source venv/bin/activate
pip install -r requirements.txt
cp .env.example .env          # add your ANTHROPIC_API_KEY
alembic upgrade head && python -m app.seed
uvicorn app.main:app --reload --port 8000

# Frontend (new terminal)
cd frontend && npm install && npm run dev
```

Backend: http://localhost:8000 | API docs: http://localhost:8000/docs | Frontend: http://localhost:5173

## Default Credentials

| Role | Email | Password |
|------|-------|----------|
| Admin | admin@aiops.local | admin123 |
| Maintainer | maintainer@aiops.local | maintain123 |
| Viewer | viewer@aiops.local | viewer123 |

## Core Modules

| Module | Owner | Description |
|--------|-------|-------------|
| M1: Service Registry | Jack | Service catalog CRUD, health check scheduling (APScheduler, HTTP probe every 5 min), connection testing |
| M2: Monitoring & Evaluation | Sakir | Dashboard metrics with P50/P95/P99 percentiles, eval harness with per-test-case drift detection |
| M3: Incident Triage | Osele | Incident lifecycle, LLM-generated summaries with human-in-the-loop approval, maintenance planning |
| M4: Governance | Jeewanjot | Immutable audit logging, compliance report generation, data classification policies, governance exports |

For a detailed module-by-module breakdown, see [MODULE_GUIDE](docs/MODULE_GUIDE.md).

## Project Structure

```
ai-health-check/
├── backend/                     # 22 Python files
│   ├── app/
│   │   ├── main.py              # FastAPI app, CORS, startup hooks
│   │   ├── config.py            # 22 settings via Pydantic BaseSettings
│   │   ├── database.py          # SQLAlchemy engine + session
│   │   ├── seed.py              # Seed data script
│   │   ├── models/              # 12 SQLAlchemy ORM models
│   │   ├── schemas/             # Pydantic request/response schemas
│   │   ├── routers/             # 7 routers, 43 endpoints
│   │   ├── services/            # llm_client.py, safety.py
│   │   └── middleware/          # auth.py, rbac.py, audit.py
│   ├── tests/                   # 5 test files, 45 tests
│   └── alembic/                 # Database migrations
├── frontend/                    # 22 JSX files
│   └── src/
│       ├── pages/               # 9 pages
│       ├── components/common/   # 13 shared components
│       ├── components/evaluations/ # 3 eval-specific components
│       ├── context/             # AuthContext (auth state + RBAC)
│       └── utils/               # Axios instance with JWT interceptor
└── docs/                        # 8 documentation files
```

## Key Features Beyond Requirements

- Prompt safety scanner: 15 injection patterns, PII detection, risk scoring (0-100)
- API budget enforcement: $5/day and $25/month caps with per-call cost tracking
- Rate limiting: 10 global + 5 per-user calls/minute
- Per-test-case drift tracking with severity classification (none/warning/critical)
- Trend analysis (improving/declining/stable) and confidence scoring
- Retry with exponential backoff (2 retries for transient errors)
- Login throttling: 5 failed attempts triggers 15-minute lockout
- WCAG 2.2 AA accessibility with ARIA roles, focus traps, screen reader support
- Dark/light themes via CSS variable design tokens
- Command palette (Cmd+K) with keyboard navigation shortcuts

## Documentation

| Document | Description |
|----------|-------------|
| [ARCHITECTURE](docs/ARCHITECTURE.md) | System architecture, API endpoints, database models, configuration reference |
| [MODULE_GUIDE](docs/MODULE_GUIDE.md) | Module-by-module breakdown with key files, endpoints, and demo flow |
| [TESTING_STRATEGY](docs/TESTING_STRATEGY.md) | Test approach, coverage details, and how to run tests |
| [ONBOARDING](docs/ONBOARDING.md) | Developer onboarding and platform lifecycle walkthrough |
| [PROMPT_CHANGE_LOG](docs/PROMPT_CHANGE_LOG.md) | LLM prompt templates and model upgrade history |
| [EVAL_DATASET_CARD](docs/EVAL_DATASET_CARD.md) | Evaluation dataset, scoring methodology, drift detection algorithm |
| [RISK_REGISTER](docs/RISK_REGISTER.md) | Identified risks and mitigations |
| [ROADMAP](docs/ROADMAP.md) | Project roadmap and milestones |
| [MAINTENANCE_RUNBOOK](docs/MAINTENANCE_RUNBOOK.md) | Operational maintenance procedures |

## Team

| Member | Module |
|--------|--------|
| Jack | M1: Service Registry |
| Sakir | M2: Monitoring & Evaluation |
| Osele | M3: Incident Triage |
| Jeewanjot | M4: Governance |

---

Academic project -- ARTI-409-A, AI Systems & Governance, 2026
