# CashFlow - Detailed Implementation Plan

## Overview

CashFlow is a cash application reconciliation system with AI-powered exception investigation. The system needs to handle financial data, provide a dashboard for viewing exceptions, run an AI agent to investigate, process jobs asynchronously with workers, and ensure reliability with approvals/audit logs.

## Tech Stack Recommendations

Given the requirements (Postgres, Redis/BullMQ, Next.js, Express, LLM), recommended:
- **Monorepo**: pnpm workspaces (or npm/yarn; pnpm better for local dev)
- **Backend API**: Express + TypeScript (apps/api)
- **Frontend**: Next.js 15 + TypeScript + Tailwind CSS (apps/web)  
- **Worker**: Node.js worker processes with BullMQ (apps/worker)
- **Shared**: TypeScript packages for types, schemas, utils (packages/shared, packages/db)
- **Database**: PostgreSQL 16+
- **Queue**: Redis 7+
- **LLM**: OpenAI/Anthropic (configurable via adapter)
- **Migrations**: node-pg-migrate or Prisma (I'll use plain SQL migrations with node-pg for simplicity)

## Project Structure

```
cashflow/
├── apps/
│   ├── api/          # Express REST API
│   ├── web/          # Next.js dashboard
│   └── worker/       # BullMQ workers
├── packages/
│   ├── db/           # DB client, migrations, queries
│   ├── shared/       # Types, schemas, constants
│   └── config/       # Env config
├── docker-compose.yml
└── README.md
```

---

## Phase 1: Financial Data & Business Logic (Core Foundation)

### 1.1 Project Setup
- [ ] Initialize monorepo with pnpm workspaces
- [ ] Configure TypeScript, tsup/esbuild, eslint, prettier
- [ ] Set up .env.example with all required vars
- [ ] Create docker-compose for local dev (postgres, redis)
- [ ] **Commit:** `chore: initialize monorepo structure`

### 1.2 Database Schema
Design tables:
- `customers` (id, name, customer_code, created_at)
- `invoices` (id, customer_id, invoice_number, amount, currency, issue_date, due_date, status, created_at)
- `payments` (id, customer_id, payment_ref, amount, currency, payment_date, method, created_at)  
- `invoice_payments` (id, invoice_id, payment_id, applied_amount, applied_at) - for allocations
- `exceptions` (id, type, status, severity, customer_id, invoice_id, payment_id, reason, detected_at, amount_delta, outstanding_balance_snapshot, metadata jsonb, assigned_to, resolved_at, resolution_notes)
- `exception_rules` (id, name, rule_type, config jsonb, active, created_at)
- `investigations` (id, exception_id, job_id, status, requested_by, requested_at, completed_at, result jsonb, evidence jsonb)
- `jobs` (id, type, status, payload jsonb, priority, attempts, max_attempts, error, started_at, finished_at, created_at)
- `audit_logs` (id, actor_id, action, entity_type, entity_id, changes jsonb, ip_address, created_at)
- `approvals` (id, request_type, entity_id, requested_by, status, approved_by, approved_at, rejected_reason, metadata jsonb)
- `outbox` (id, event_type, payload jsonb, published, published_at, created_at)

- [ ] Write migration SQL files
- [ ] Create db package with connection pool (node-postgres)
- [ ] Add migration runner script
- [ ] **Commit:** `feat(db): add core schema and migration infrastructure`

### 1.3 Synthetic Data Generation
- [ ] Script to generate customers, invoices, payments with realistic distributions
- [ ] Create mismatches: partial payments, duplicate payments, overpayments, unapplied payments, timing issues
- [ ] Generate exception cases programmatically
- [ ] Add seed command
- [ ] **Commit:** `feat(db): add synthetic data seeding`

### 1.4 Business Logic
- [ ] Outstanding balance calculation: invoice.amount - sum(applied payments)
- [ ] Exception classification rules (amount mismatch, timing, missing reference, duplicate, etc.)
- [ ] Detection service to scan and create exceptions
- [ ] Balance reconciliation utilities
- [ ] Unit tests for calculations
- [ ] **Commit:** `feat(core): add reconciliation logic and exception classification`

---

## Phase 2: REST API & Dashboard

### 2.1 Express API Setup
- [ ] API server with Express, helmet, cors, compression, pino logging
- [ ] Request validation (zod)
- [ ] Error handling middleware
- [ ] Health check endpoint
- [ ] **Commit:** `feat(api): bootstrap Express server`

### 2.2 API Endpoints
Implement:
- `GET /api/exceptions` - list with filters (status, type, severity, customer)
- `GET /api/exceptions/:id` - details with related data
- `POST /api/exceptions/:id/investigate` - trigger investigation (enqueue job)
- `GET /api/investigations/:id` - investigation details
- `GET /api/jobs/:id` - job status
- `POST /api/approvals` - create approval request
- `PATCH /api/approvals/:id` - approve/reject
- `GET /api/audit-logs` - audit trail

- [ ] Add controllers, services, routes
- [ ] Auth middleware (basic RBAC - roles: viewer, analyst, approver, admin)
- [ ] Idempotency key support for write ops
- [ ] API tests (vitest + supertest)
- [ ] **Commit:** `feat(api): implement REST endpoints`

### 2.3 Next.js Dashboard
- [ ] Next.js app router setup with TypeScript, Tailwind
- [ ] Layout with navigation (Exceptions, Investigations, Jobs, Approvals, Audit)
- [ ] Exceptions list page with filters, sorting, pagination
- [ ] Exception detail page showing: invoice/payment details, outstanding balance, reason, history
- [ ] Investigation submission form
- [ ] Job status display (polling)
- [ ] Approvals workflow UI
- [ ] Audit log viewer
- [ ] Loading/error states
- [ ] **Commit:** `feat(web): build dashboard UI`

### 2.4 API Client
- [ ] Shared API types in packages/shared
- [ ] Fetch utilities with error handling
- [ ] **Commit:** `chore: share types between api and web`

---

## Phase 3: AI Agent

### 3.1 LLM Provider Adapter
- [ ] Abstract interface: `LLMProvider` with `complete`, `stream` methods
- [ ] OpenAI adapter implementation
- [ ] Anthropic adapter (optional but good)
- [ ] Config via env (provider, model, api key)
- [ ] **Commit:** `feat(agent): add LLM provider abstraction`

### 3.2 Agent Core
- [ ] Tool-calling loop (function calling / tool use)
- [ ] System prompt for cash reconciliation expert
- [ ] Response schema (structured output) for recommendations
- [ ] Evidence tracking - log each tool call and result
- [ ] **Commit:** `feat(agent): implement agent core with tool loop`

### 3.3 Agent Tools
Tools for financial data retrieval:
- `getInvestigationContext(exceptionId)` - exception, invoice/payment balances, and similar cases in one call
- `getExceptionDetails(exceptionId)` - full context
- `getCustomerInvoices(customerId, limit?)` - history
- `getInvoicePayments(invoiceId)` - allocations
- `getCustomerPayments(customerId, limit?)` - payment history
- `searchTransactions(query)` - flexible search
- `calculateBalances(invoiceId)` - recompute
- `getSimilarExceptions(exceptionId)` - patterns

- [x] Tool implementations with validation
- [x] Tool registry
- [x] Bundle the initial investigation context; execute independent PostgreSQL reads concurrently
- [x] Cache similar-exception history in Redis for 15 seconds; keep current financial balances on PostgreSQL
- [ ] **Commit:** `feat(agent): add financial data tools`

### 3.4 Agent Logic
- [x] Analyze exception - gather evidence via tools
- [x] Generate structured recommendation: action (hold/release/adjust/approve_manual), confidence, rationale, evidence_refs[], suggested_adjustments
- [x] Evidence validation - ensure claims backed by data
- [x] Save investigation result with evidence trail
- [x] Record agent duration, tool-call count, and cache hits/misses in logs and audit metadata
- [ ] Add a replayable, labeled evaluation set and compare recommendation quality across prompt/model versions
- [ ] Add vector retrieval for unstructured remittance advice and historical analyst notes
- [ ] **Commit:** `feat(agent): implement investigation logic`

---

## Phase 4: Distributed Processing

### 4.1 Queue Setup
- [ ] Redis connection in all services
- [ ] BullMQ queue definitions (investigations, notifications)
- [ ] Job types and payload schemas
- [ ] **Commit:** `feat(queue): setup BullMQ queues`

### 4.2 Worker Processes
- [ ] Independent worker app (apps/worker)
- [ ] Investigation worker: runs AI agent on exception
- [ ] Notification worker (optional for now)
- [ ] Concurrency config
- [ ] Job processing with proper error handling
- [ ] **Commit:** `feat(worker): implement investigation worker`

### 4.3 Async Flow
- [ ] API enqueues investigation job when POST /investigate called
- [ ] Job status persisted to DB (jobs table)
- [ ] API can poll job status
- [ ] Web UI shows job progress
- [ ] Retries with exponential backoff
- [ ] Dead letter queue handling (failed after max attempts)
- [ ] **Commit:** `feat(async): connect API, queue, worker`

---

## Phase 5: Reliability & Approvals

### 5.1 Idempotency
- [ ] Idempotency middleware for write endpoints (check idempotency_key header)
- [ ] Store responses by key, return cached on replay
- [ ] **Commit:** `feat(reliability): add idempotency support`

### 5.2 Transactional Outbox
- [ ] Outbox table + events
- [ ] Write events in same transaction as state change
- [ ] Outbox publisher (poller) to relay events to queue
- [ ] Ensure at-least-once delivery
- [ ] **Commit:** `feat(reliability): implement transactional outbox`

### 5.3 RBAC & Approvals
- [ ] Role-based access control (viewer/analyst/approver/admin)
- [ ] Approval workflow for sensitive actions (e.g. write-off, adjustment > threshold)
- [ ] Approval endpoints + UI
- [ ] **Commit:** `feat(approvals): add RBAC and approval workflow`

### 5.4 Audit Logs
- [ ] Audit logging middleware/service
- [ ] Log all significant actions (investigate, approve/reject, resolve)
- [ ] Immutable audit trail
- [ ] Audit UI
- [ ] **Commit:** `feat(audit): add audit logging`

### 5.5 Simulated Downstream Actions
- [ ] Action executor service (mocked - just logs + updates state)
- [ ] Actions: mark resolved, create adjustment record, notify
- [ ] **Commit:** `feat(actions): add simulated downstream actions`

---

## Phase 6: Polish & Documentation

### 6.1 Docker Compose
- [ ] Complete docker-compose.yml: postgres, redis, api, web, worker
- [ ] Health checks
- [ ] Volume mounts for data
- [ ] .env.docker support
- [ ] **Commit:** `chore(docker): add full docker compose setup`

### 6.2 Architecture Diagram
- [ ] Create `docs/architecture.md` with system diagram (can use Mermaid or ASCII)
- [ ] Include data flow: detection → exception → investigate → agent → recommendation → approval → action
- [ ] **Commit:** `docs: add architecture diagram`

### 6.3 README
- [ ] Project overview, features, tech stack
- [ ] Quick start (local dev + docker)
- [ ] Env vars
- [ ] API docs summary
- [ ] Demo flow instructions
- [ ] **Commit:** `docs: update README with setup and demo`

### 6.4 Clean Demo Flow
- [ ] Seed data with interesting exception cases
- [ ] Demo script: show exception list → detail → trigger investigation → watch job → see recommendation → approval flow
- [ ] Sample LLM responses or fallback for demo (if no API key)
- [ ] **Commit:** `feat(demo): add demo data and flow`

### 6.5 Interview Prep
- [ ] Add `INTERVIEW.md` with talking points: design decisions, outbox, agent architecture, trade-offs
- [ ] Key technical highlights
- [ ] **Commit:** `docs: add interview preparation notes`

---

## Development Guidelines

### Commits
- Follow conventional commits: feat:, fix:, chore:, docs:, refactor:, test:
- Commit after each logical unit (as listed above)
- Keep commits focused and atomic
- **Always run:** `git add . && git commit -m "..."`

### Code Quality
- TypeScript strict mode
- ESLint + Prettier
- Meaningful types, no `any` unless justified
- Zod for runtime validation
- Structured logging (pino)

### Testing Strategy
- Unit tests for business logic (Phase 1)
- API integration tests (Phase 2)
- Agent tool tests (Phase 3)
- Worker/job tests (Phase 4)

### Environment Variables
Key vars:
```
DATABASE_URL=postgresql://...
REDIS_URL=redis://...
PORT=3001 (api)
NEXT_PUBLIC_API_URL=http://localhost:3001
LLM_PROVIDER=openai
OPENAI_API_KEY=...
LLM_MODEL=gpt-4o-mini
NODE_ENV=development
```

---

## Implementation Order & Timeline

**Day 1:** Phase 1 (Foundation) - schema, data, core logic  
**Day 2:** Phase 2 (API + Dashboard) - endpoints, UI  
**Day 3:** Phase 3 (AI Agent) - provider, tools, loop  
**Day 4:** Phase 4 (Workers) - queue, workers  
**Day 5:** Phase 5 (Reliability) - outbox, approvals, audit  
**Day 6:** Phase 6 (Polish) - docker, docs, demo

But implement incrementally, committing often.

---

## Next Steps

Start with Phase 1.1: Initialize monorepo. Let me do that now.
