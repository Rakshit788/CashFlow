# CashFlow

AI-powered **cash application reconciliation** system. It detects payment/invoice
mismatches, runs an LLM agent to investigate each exception with real financial data,
and routes recommendations through an approval workflow before applying downstream
actions — with an idempotent, audited, transactional-outbox backend.

## Features

- Synthetic financial data generation with realistic mismatch scenarios.
- Rule-based exception detection: unapplied payments, partial/amount mismatches,
  overpayments, duplicate payments, timing/collection issues.
- Express REST API with Zod validation, RBAC, and idempotent write endpoints.
- LLM agent with a tool-calling loop over financial data (local Ollama by default; OpenAI / Anthropic compatible adapters),
  plus a deterministic **rule-based fallback** so the demo works without an API key.
- pgvector semantic retrieval for synthetic remittance notes; the agent verifies retrieved
  candidate references against current PostgreSQL invoice and payment balances.
- Labeled agent replay evaluator with per-case outcomes and latency metrics.
- Structured recommendations with a full evidence trail.
- BullMQ workers + Redis, with a transactional **outbox** publisher for reliable
  async delivery and retries with exponential backoff.
- Approval workflow (analyst requests → approver decides) and a simulated action
  executor that records adjustments.
- Immutable audit log.
- Next.js dashboard: exceptions, investigations, jobs, approvals, audit.

## Tech Stack

| Layer | Technology |
| ----- | ---------- |
| Monorepo | npm workspaces, TypeScript (strict) |
| API | Express, Zod, Pino, Helmet, CORS |
| Dashboard | Next.js 15 (App Router), React 19, Tailwind CSS |
| Queue | BullMQ + Redis |
| Database | PostgreSQL 16 + pgvector (`node-postgres`, plain SQL migrations) |
| LLM | Ollama in Docker (Qwen 3 1.7B), OpenAI-compatible adapter, optional OpenAI embeddings, and rule-based fallback |

## Repository Structure

```
cashflow/
├── apps/
│   ├── api/          # Express REST API
│   ├── web/          # Next.js dashboard
│   └── worker/       # BullMQ worker + outbox publisher
├── packages/
│   ├── db/           # connection, migrations, reconciliation, seed
│   ├── shared/       # shared types + Zod schemas
│   ├── queue/        # Redis connection + queue definitions
│   └── agent/        # LLM adapter, tools, agent core, investigation logic
├── docs/architecture.md
├── docker-compose.yml
└── Dockerfile
```

## Quick Start

### Option A — Docker (everything)

```bash
docker compose up --build
# first run only: download the local model into the persistent Ollama volume
docker compose exec ollama ollama pull qwen3:1.7b
docker compose exec api node packages/db/dist/migrate.js
docker compose exec api node packages/db/dist/seed.js
docker compose exec api node packages/db/dist/reconciliation.js   # detect exceptions
docker compose exec api npm run index-remittance -w @cashflow/agent  # optional; requires OPENAI_EMBEDDING_API_KEY
```

- Dashboard: http://localhost:3000
- API: http://localhost:3001

### Option B — Local dev

Prerequisites: Node 20+, and Docker for Postgres, Redis, and Ollama.

```bash
cp .env.example .env      # then edit if needed
npm run docker:up         # start Postgres, Redis, and Ollama
docker compose exec ollama ollama pull qwen3:1.7b  # first run only
npm install
npm run build:packages
npm run migrate           # create schema
npm run seed              # generate synthetic data
npm run detect            # create exceptions
npm run index-remittance -w @cashflow/agent  # optional vector index; requires OPENAI_EMBEDDING_API_KEY

npm run dev:api           # terminal 1  -> http://localhost:3001
npm run dev:worker        # terminal 2
npm run dev:web           # terminal 3  -> http://localhost:3000
```

## Environment Variables

See `.env.example`. Key variables:

| Variable | Purpose |
| -------- | ------- |
| `DATABASE_URL` | PostgreSQL connection string |
| `REDIS_URL` | Redis connection string |
| `PORT` | API port (default 3001) |
| `NEXT_PUBLIC_API_URL` | API base URL used by the dashboard |
| `LLM_PROVIDER` / `LLM_MODEL` / `LLM_BASE_URL` | Local Ollama model configuration (default `qwen3:1.7b`) |
| `OPENAI_EMBEDDING_API_KEY` / `OPENAI_BASE_URL` / `OPENAI_EMBEDDING_MODEL` | Optional external embedding service for remittance retrieval; leave key blank to keep requests local |
| `APPROVAL_THRESHOLD` | Amount above which adjustments require approval |
| `MAX_JOB_ATTEMPTS` | Worker retry limit |
| `OUTBOX_POLL_INTERVAL_MS` | Outbox publisher poll interval |
| `DEFAULT_USER_ROLE` | Fallback role when no role header is sent |

## API Summary

| Method | Path | Role | Description |
| ------ | ---- | ---- | ----------- |
| GET | `/health` | – | Health check |
| GET | `/api/exceptions` | viewer | List with `status`/`type`/`severity`/`customer_id` filters + pagination |
| GET | `/api/exceptions/:id` | viewer | Detail with invoices, payments, investigations, approvals |
| POST | `/api/exceptions/:id/investigate` | analyst | Enqueue an AI investigation |
| POST | `/api/exceptions/:id/resolve` | analyst | Manually resolve |
| GET | `/api/investigations/:id` | viewer | Investigation result + evidence |
| GET | `/api/jobs` / `/api/jobs/:id` | viewer | Job status |
| GET | `/api/approvals` | viewer | List approvals |
| POST | `/api/approvals` | analyst | Create an approval request |
| PATCH | `/api/approvals/:id` | approver | Approve/reject (executes action on approve) |
| GET | `/api/audit-logs` | viewer | Audit trail |

Write endpoints honor an `Idempotency-Key` header. Request identity uses
`x-user-id` / `x-user-role`.

## Demo Flow

1. Run seed + detect, open the dashboard.
2. Open an `unapplied_payment` exception → **Run AI Investigation**.
3. Watch the job move `waiting → active → completed` on the Jobs page.
4. The exception now shows the recommendation, confidence, rationale, and evidence trail.
5. Switch the dashboard role to **approver**, go to **Approvals**, and approve.
6. The action executor records adjustment(s) and resolves the exception; the audit log
   captures every step.

## Development

```bash
npm run build            # build all packages + apps
npm run migrate          # apply SQL migrations
npm run seed             # reset + seed data
npm run detect           # run exception detection
npm run index-remittance -w @cashflow/agent  # index synthetic remittance notes (requires OpenAI key)
```

The replay evaluator writes temporary cases only to a dedicated database whose name contains
`eval`. Set `EVALUATION_DATABASE_URL` to that database, set `DATABASE_URL` to the same URL for
the migration command, run migrations, then run `npm run evaluate -w @cashflow/agent`.

See `docs/architecture.md` for the system design and reliability patterns.
