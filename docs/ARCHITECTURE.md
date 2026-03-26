# AIHealthCheck Architecture Document

AIHealthCheck is an "AI Operations Control Room" built for university course **ARTI-409-A**. It provides a centralized platform to monitor, evaluate, triage, and govern an organization's suite of AI models and LLM wrappers.

This document details the complete end-to-end architecture, from the web frontend to the database layer and external LLM interactions.

## 1. High-Level Architecture Overview

The system strictly adheres to a decoupled **Client-Server Architecture**:
- **Client (Frontend):** A Single Page Application (SPA) built with React 18 and Vite.
- **Server (Backend):** A RESTful API built with FastAPI (Python 3.11+).
- **Data Persistence (Database):** A relational SQLite database accessed vertically via SQLAlchemy.
- **External Dependencies:** The Anthropic API (Claude) acting as the underlying LLM inference provider.

---

## 2. Frontend Layer (React + Vite)

The frontend is engineered as a premium enterprise SaaS dashboard. It focuses on high-fidelity user workflows, declarative chart rendering, and strict Role-Based Access Control (RBAC) handling.

### Technology Stack
- **Framework:** React 18 powered by Vite for rapid Hot Module Replacement (HMR) and optimized building.
- **Styling:** Tailwind CSS with a unified *dark navy/slate* color palette (`index.css`) for utility-first styling without external bloat.
- **Routing:** `react-router-dom` using declarative `<ProtectedRoute>` wrappings to prevent unauthorized access.
- **Data Visualization:** `recharts` for composing the underlying SVG area, bar, and line metric charts in the dashboard.
- **Iconography:** `lucide-react` for crisp SVG icons matching the typography grid.

### Key Components & Layouts
- **Common Module (`src/components/common/`):** Houses reusable atomic components such as `Sidebar.jsx`, `MetricCard.jsx`, `Modal.jsx`, `StatusBadge.jsx`, and `DataTable.jsx`.
- **Axios HTTP Client (`src/utils/api.js`):** A configured Axios instance that dynamically injects JWT access tokens via an interceptor, simplifying external API consumption.
- **Authentication Context (`src/context/AuthContext.jsx`):** A React Context API hook (`useAuth`) that broadcasts the currently authenticated user's session payload, role (`admin`, `maintainer`, `viewer`), and corresponding boolean flags (`canEdit`, `isAdmin`).

---

## 3. Backend Layer (FastAPI)

The backend acts as the core traffic controller, handling payload validation, database mutations, identity verification, and background scheduling.

### Technology Stack
- **Framework:** FastAPI utilizing `asyncio` for non-blocking standard I/O and blazing fast JSON serialization.
- **Authentication:** OAuth2 with cryptographically signed JSON Web Tokens (JWT). Passwords are hashed using `bcrypt`.
- **Data Validation:** Pydantic models for rigid compile-time checking of request payloads, response serialization, and environment variable configuration.
- **Job Scheduling:** `APScheduler` is utilized to asynchronously ping services or execute evaluation datasets outside the main event loop.

### Application Structure
- **`main.py`:** The entry point loading ASGI middleware (CORS, exception handling) and bootstrapping the routers framework.
- **`routers/`:** Route segregation based on distinct business domain logic (e.g. `routers/services.py`, `routers/incidents.py`, `routers/audit.py`).
- **`middleware/`:** Custom dependency injection chains ensuring active users are authorized for the given endpoint (using standard FastAPI `Depends()`).
- **`services/llm_client.py`:** A dedicated REST abstraction wrapper over the Anthropic API. By centralizing the Python SDK into one location, the backend can effortlessly swap LLM providers (i.e. to OpenAI or a local Ollama binary) without disturbing application functionality.

---

## 4. Database Layer (SQLite + SQLAlchemy)

Data persistence is structured using standard normalized schema methodology, using an embedded SQLite file (`aiops.db`) for academic portability.

### Technology Stack
- **ORM:** SQLAlchemy (v2.0+) acting as the unit-of-work wrapper for executing raw SQL queries via Python objects.
- **Migrations:** Alembic is utilized to programmatically control schema changes and apply incremental version control tracking across environments.

### Core Data Models
1. **Users:** Handles identity mappings, RBAC enum tracking, and hashed secrets.
2. **Services (`ai_services`):** The primary registry tracking endpoint URLs, owner namespaces, and model tags.
3. **Telemetry & Evaluations:** High-volume time-series tables recording response latency, concept drift thresholds, and hallucination scores from tests.
4. **Incidents & Maintenance:** Tables governing manual post-mortem forms, AI summary drafts, and rollback action plans.
5. **Audit Logs:** Immutable ledge structures recording all `POST`, `PUT`, and `DELETE` requests made across the application for strict compliance requirements.

---

## 5. Security & Data Policy Strategy

To comply with enterprise standards, AIHealthCheck employs specific data handling protocols:
1. **Never persist test input prompts:** Evaluation text inputs passing to Anthropic are kept entirely in-memory and discarded upon scoring to prevent data leaks.
2. **Sensitivity Badging:** Features dynamically lock down depending on standard data classification (Public, Internal, Confidential).
3. **Minimal Telemetry:** Only numeric metrics, identifiers, and pre-formatted system logs are physically written to SQLite.
