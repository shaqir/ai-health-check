# AIHealthCheck Roadmap

## Overview

AIHealthCheck (ARTI-409-A) was delivered across a four-week sprint. All four project phases are complete. The platform monitors deployed AI services using Claude Sonnet 4.6 (`claude-sonnet-4-6-20250415`) via the Anthropic SDK (`anthropic>=0.49.0`), with a React 18 + Vite + Tailwind frontend and a FastAPI + SQLAlchemy + SQLite backend.

## Phase Timeline

| Phase | Name | Deliverables | Status |
|-------|------|-------------|--------|
| 1 | Foundation | Database schema (SQLite, 12 models), FastAPI scaffolding, React project initialization | Complete |
| 2 | UI Design | Dark/light theme design system (CSS variable tokens), Recharts integration, responsive layouts, 9 pages, 16 components | Complete |
| 3 | Backend Wiring | 7 routers (43 endpoints), LLM client integration, prompt safety scanner, budget enforcement, advanced drift detection, login throttling, 45 tests across 5 files | Complete |
| 4 | QA and Finalization | End-to-end verification, security audit, WCAG 2.2 AA accessibility pass, keyboard navigation (Cmd+K palette, G+key jump nav), final documentation | Complete |

## Module Ownership

| Module | Owner | Scope |
|--------|-------|-------|
| M1: Service Registry | Jack | Service CRUD, connection testing, sensitivity labels |
| M2: Monitoring and Evaluations | Sakir | Dashboard metrics, drift detection, percentile calculations, scheduled health checks |
| M3: Incident Triage | Osele | Incident lifecycle, AI-assisted drafting (human-in-the-loop), maintenance planning |
| M4: Governance | Jeewanjot | RBAC (admin/maintainer/viewer), audit logging, compliance export, login throttling |

## Features Delivered Beyond Requirements

- Prompt safety scanner with 15 injection patterns, PII detection, length limits, and risk scoring (PromptSafetyError, HTTP 422)
- Budget enforcement with daily $5 and monthly $25 caps, global 10/min and per-user 5/min rate limits (BudgetExceededError, HTTP 402/429)
- Advanced drift detection with severity levels (none/warning/critical), trend direction (improving/declining/stable), variance calculation, per-test EvalResult tracking, P50/P95/P99 percentiles, and confidence bands (low/medium/high)
- JWT + bcrypt authentication with RBAC across three roles, login throttling (5 attempts per 15 minutes via LoginAttempt model), and input sanitization
- WCAG 2.2 AA accessibility: Cmd+K command palette, G+key jump navigation, focus traps, ARIA roles, skip-to-main link, prefers-reduced-motion support
- Scheduled background health checks every 5 minutes (HTTP-only, no Claude API consumption)
- Human-in-the-loop approval required for all LLM-generated actions
- Retry with exponential backoff on transient LLM failures
- 45 automated tests (13 service, 11 evaluation, 10 dashboard, 10 compliance, 2 integration)
