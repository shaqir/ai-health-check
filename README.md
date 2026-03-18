# AIHealthCheck

> ARTI-409-A | AI Systems & Governance | Group Project
> Team: Jack, Sakir, Osele, Jeewanjot

Health checks for your AI fleet — a centralized platform to monitor, evaluate, triage, and govern your organization's AI services.

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 18 + Vite + Tailwind CSS |
| Backend | FastAPI (Python 3.11+) |
| Database | SQLite via SQLAlchemy |
| LLM | Anthropic Claude API (via REST wrapper) |
| Scheduler | APScheduler |
| Testing | Pytest + React Testing Library |

## Quick Start

### Prerequisites

- Python 3.11+
- Node.js 18+
- Git

### 1. Clone the repository

```bash
git clone https://github.com/YOUR_TEAM/ai-health-check.git
cd ai-health-check
```

### 2. Backend setup

```bash
cd backend

# Create virtual environment
python -m venv venv
source venv/bin/activate        # macOS/Linux
# venv\Scripts\activate         # Windows

# Install dependencies
pip install -r requirements.txt

# Copy environment variables
cp .env.example .env
# Edit .env and add your ANTHROPIC_API_KEY

# Run database migrations
alembic upgrade head

# Seed initial data (admin user + sample services)
python -m app.seed

# Start the backend server
uvicorn app.main:app --reload --port 8000
```

Backend runs at: http://localhost:8000
API docs at: http://localhost:8000/docs

### 3. Frontend setup

```bash
cd frontend

# Install dependencies
npm install

# Start the dev server
npm run dev
```

Frontend runs at: http://localhost:5173

### 4. Default login credentials

| Role | Email | Password |
|------|-------|----------|
| Admin | admin@aiops.local | admin123 |
| Maintainer | maintainer@aiops.local | maintain123 |
| Viewer | viewer@aiops.local | viewer123 |

## Project Structure

```
ai-health-check/
├── backend/
│   ├── app/
│   │   ├── main.py              # FastAPI app + CORS + startup
│   │   ├── config.py            # Settings from .env
│   │   ├── database.py          # SQLAlchemy engine + session
│   │   ├── seed.py              # Seed data script
│   │   ├── models/              # SQLAlchemy ORM models
│   │   │   ├── user.py
│   │   │   ├── service.py
│   │   │   ├── evaluation.py
│   │   │   ├── incident.py
│   │   │   ├── maintenance.py
│   │   │   ├── audit.py
│   │   │   └── telemetry.py
│   │   ├── schemas/             # Pydantic request/response schemas
│   │   ├── routers/             # API route handlers
│   │   │   ├── auth.py          # Login, register
│   │   │   ├── services.py      # Service registry CRUD
│   │   │   ├── evaluations.py   # Eval harness + drift
│   │   │   ├── incidents.py     # Incident triage
│   │   │   ├── maintenance.py   # Maintenance planner
│   │   │   ├── dashboard.py     # Metrics + telemetry
│   │   │   └── compliance.py    # Audit log + export
│   │   ├── services/            # Business logic layer
│   │   │   └── llm_client.py    # *** LLM REST wrapper ***
│   │   └── middleware/
│   │       ├── auth.py          # JWT verification
│   │       ├── rbac.py          # Role-based access control
│   │       └── audit.py         # Auto audit logging
│   ├── tests/
│   │   ├── test_services.py
│   │   ├── test_evaluations.py
│   │   ├── test_auth.py
│   │   └── test_integration.py
│   ├── alembic/                 # DB migrations
│   ├── alembic.ini
│   ├── requirements.txt
│   └── .env.example
├── frontend/
│   ├── src/
│   │   ├── App.jsx
│   │   ├── main.jsx
│   │   ├── components/
│   │   ├── pages/
│   │   ├── hooks/
│   │   ├── utils/
│   │   └── context/
│   ├── index.html
│   ├── package.json
│   ├── vite.config.js
│   └── tailwind.config.js
├── docs/
│   ├── PROMPT_CHANGE_LOG.md
│   ├── RISK_REGISTER.md
│   ├── EVAL_DATASET_CARD.md
│   └── MAINTENANCE_RUNBOOK.md
├── .gitignore
└── README.md
```

## Running Tests

```bash
# Backend tests
cd backend
pytest -v

# Frontend tests
cd frontend
npm test
```

## Team

| Member | Primary Module |
|--------|---------------|
| Jack | Module 1: Service Registry + Backend Core |
| Sakir | Module 2: Monitoring Dashboard + Eval Harness |
| Osele | Module 3: Incident Triage + LLM Integration |
| Jeewanjot | Module 4: Governance + Documentation |

## License

Academic project — ARTI-409-A, March 2026
