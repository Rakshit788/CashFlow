# STATUS.md — CashFlow: What's Done, What's Left

> Updated snapshot of the repository state (2026-10-17).  
> This file is a living checklist — update it as work progresses.

---

## 1. Git State

| Fact | Detail |
|---|---|
| Branch | `main`; local commits have not been pushed |
| Last commit | `e4111b5` — default Gemini to a model available to new users |
| Committed so far | Database, agent, API, worker, dashboard, pgvector retrieval, replay evaluation, docs, and container setup |
| **Not committed** | Gemini thought-signature preservation fix and this verification update |

**Verification (2026-10-17):** The replacement Gemini key is present locally and a generic generation probe succeeded with `gemini-3.8-flash`. The seven-case isolated replay scored 7/7, but Gemini free-tier quota (5 requests/minute) was exhausted during the run, so those cases used the deterministic fallback; this is not an LLM evaluation result. The Gemini tool-call adapter now preserves `extra_content.google.thought_signature` as required for Gemini 3 tool round trips; the agent package TypeScript build passed. A full workspace build reached Next.js but failed with Windows `EPERM` writing under `apps/web/.next`, and `npm test` has no workspace test scripts. The read-only API health and exceptions endpoints responded successfully. A Gemini-backed replay and live worker run remain unverified; the normal compose worker was not started because it may process real queued finance records and send them to Google.

**Local runtime:** Postgres, Redis, API, and the fallback-only worker are running. The normal Gemini-configured worker remains stopped because it may process real queued finance records. Existing demo rows were preserved; the seed reset was not run.

---

## 2. Things DONE

### Repository / Infrastructure
- [x] npm-workspaces monorepo (root `package.json`) with `apps/*` and `packages/*`
- [x] Shared strict TypeScript base config (`tsconfig.base.json`) — `strict: true`, composite, declarations
- [x] 6 workspace tsconfigs extending the base
- [x] `.env.example` with every config key documented; local `.env` present
- [x] `.gitignore` excludes `dist/`, `.next/`, `node_modules`, `.env`, `*.tsbuildinfo`
- [x] `docker-compose.yml`: postgres:16, redis:7 (both with healthchecks), api, worker, web
- [x] Multi-stage root `Dockerfile` with `api` and `worker` targets
- [x] `apps/web/Dockerfile` (Next.js builder → runtime)
- [x] `.dockerignore`
- [x] Docs: `README.md`, `INTERVIEW.md`, `docs/architecture.md` (Mermaid diagram, end-to-end flow, RBAC table, key tables)

### `packages/shared`
- [x] `src/types.ts` — `Exception`, `Investigation`, `Job` interfaces + all status/severity enums
- [x] `src/schemas.ts` — `InvestigateExceptionSchema`, `CreateApprovalSchema`, `ApproveRejectSchema` (Zod)
- [x] `src/index.ts` — barrel exports
- [x] `dist/` build output present

### `packages/db`
- [x] `src/db.ts` — pg `Pool`, `query()`, `getClient()`, auto-loads `.env`
- [x] `src/migrate.ts` — migration runner (creates `migrations` table, applies `*.sql` in order, transactional per file)
- [x] `src/seed.ts` — synthetic data: 5 customers, 2–4 invoices each, 1–N payments with partial allocations
- [x] `src/reconciliation.ts` — `getOutstandingBalance()`, `classifyCustomer()`, `detectExceptions()`, CLI entrypoint
- [x] `migrations/001_initial.sql` — 10 tables + 6 indexes (customers, invoices, payments, invoice_payments, exception_rules, exceptions, investigations, jobs, audit_logs, approvals, outbox)
- [x] `migrations/002_phase5.sql` — `idempotency_keys` + `adjustments` tables

### `packages/queue`
- [x] `src/index.ts` — `QUEUE_INVESTIGATIONS`, `QUEUE_NOTIFICATIONS`, `JOB_INVESTIGATE_EXCEPTION` constants; `createRedisConnection()`, `createQueue()`

### `packages/agent`
- [x] `src/llm.ts` — `LLMProvider` interface, `loadProviderConfig()`, OpenAI, Anthropic, and Gemini (OpenAI-compatible) providers; preserves Gemini tool-call thought signatures; `createProvider()` returns null if no key
- [x] `src/tools.ts` — 9 tools implemented, including bundled context and customer-scoped semantic remittance search; independent invoice/payment/history reads run concurrently
- [x] Redis caches only similar-exception history for 15 seconds; current invoice, payment, and balance data always comes from PostgreSQL
- [x] `src/evaluate.ts` — labeled replay CLI with a dedicated-database guard, expected-action scoring, and JSON report (provider/model, confidence, evidence, duration, tool/cache metrics)
- [x] `src/embeddings.ts` and `src/indexRemittance.ts` — OpenAI-compatible embedding client and synthetic-only remittance indexer
- [x] `src/schema.ts` — `RecommendationSchema`, `SuggestedAdjustmentSchema` (Zod)
- [x] `src/agent.ts` — `SYSTEM_PROMPT`, `runLlmAgent()` (tool-calling loop), `runRuleBasedAgent()` (deterministic fallback), `runAgent()` (LLM → fallback); includes duration, tool-call, and cache metrics
- [x] `src/investigate.ts` — `runInvestigation()`: runs agent, updates DB, auto-resolves on `release`, else creates approval + audit + outbox events
- [x] `src/index.ts` — barrel exports

### `apps/api`
- [x] `src/app.ts` — helmet, cors, express.json, `attachUser`, `idempotency`, `/health`, 5 routers, error handler
- [x] `src/routes/exceptions.ts` — `GET /` (filter + pagination), `GET /:id` (detail with invoices/payments/investigations/approvals), `POST /:id/investigate`, `POST /:id/resolve`
- [x] `src/routes/investigations.ts` — `GET /:id`
- [x] `src/routes/jobs.ts` — `GET /` (limit 50), `GET /:id`
- [x] `src/routes/approvals.ts` — `GET /`, `POST /`, `PATCH /:id` (approve/reject; calls `executeRecommendation` on approve)
- [x] `src/routes/audit.ts` — `GET /` (limit 100)
- [x] `src/middleware/rbac.ts` — `requireRole()`, `actorOf()`, role hierarchy (viewer < analyst < approver < admin)
- [x] `src/middleware/idempotency.ts` — `Idempotency-Key` claim via `INSERT ... ON CONFLICT`, stores/replays response, 409 for in-flight
- [x] `src/middleware/error.ts` — `HttpError`, `errorHandler`, `asyncHandler`
- [x] `src/services/actions.ts` — `executeRecommendation()`: writes `adjustments`, resolves exception, audit + outbox

### `apps/worker`
- [x] `src/index.ts` — boots investigation worker + outbox publisher, graceful SIGINT/SIGTERM shutdown
- [x] `src/investigationWorker.ts` — BullMQ worker; idempotent job guard (skips already-completed jobs); retries with backoff; failure path updates `jobs.failed` / `investigations.failed` / exception back to `open`
- [x] `src/outboxPublisher.ts` — polls outbox `FOR UPDATE SKIP LOCKED`, enqueues investigation jobs (`jobId: db-<id>`), pushes to notifications queue, marks published
- [x] `src/logger.ts` — pino
- [x] `src/env.ts` — dotenv loader

### `apps/web`
- [x] `src/app/layout.tsx` — root layout + `Nav`
- [x] `src/app/page.tsx` — dashboard: status count cards + recent exceptions table
- [x] `src/app/exceptions/page.tsx` — list with status/type/severity filters, pagination
- [x] `src/app/exceptions/[id]/page.tsx` — detail: "Run AI Investigation" + job polling, manual resolve, latest investigation (action / confidence / rationale / evidence trail), inline approve/reject, invoices & payments tables
- [x] `src/app/jobs/page.tsx` — jobs table with 3s polling
- [x] `src/app/approvals/page.tsx` — approvals table with approve/reject
- [x] `src/app/audit/page.tsx` — audit log table
- [x] `src/components/Nav.tsx` — nav + role selector (persists to localStorage)
- [x] `src/components/Badge.tsx` — status/severity badge
- [x] `src/lib/api.ts` — typed fetch client with role/user-id headers
- [x] Tailwind config, PostCSS config, `next.config.js`, `tsconfig.json`
- [x] `.next/` production build artifact present

### Root scripts
- [x] `build:packages`, `build`, `migrate`, `seed`, `detect`, `dev:api`, `dev:worker`, `dev:web`, `docker:up`, `docker:down`

---

## 3. Bugs Found

| # | Location | Issue |
|---|---|---|
| B2 | `apps/api/src/routes/exceptions.ts:103` vs `packages/agent/src/investigate.ts` | Exception detail queries `request_type = 'exception'`, but `investigate.ts` writes `request_type = 'investigation_recommendation'`. The inline approval UI on the exception detail page (`page.tsx:85`) filters for `request_type === 'investigation_recommendation'`, so AI-generated approvals **never appear** on the exception detail. |
| B3 | `apps/api/src/middleware/idempotency.ts` | `request_hash` is computed and stored but **never compared** on replay — a different request with the same `Idempotency-Key` would get the cached response. |
| B4 | `apps/api/src/routes/approvals.ts` (`PATCH /:id`) | Approving a non-`investigation_recommendation` request type (e.g. `manual_adjustment`) marks it approved but **runs no action** — the approval is a no-op. |
| B5 | `packages/db/src/seed.ts` | Does not clear `idempotency_keys` or `adjustments` on reseed — stale rows persist. |

**Resolved:** B1 in `packages/agent/src/agent.ts` was fixed while updating the fallback path. The `unapplied_payment` recommendation is no longer overwritten by an unconditional `hold`.

---

## 4. What's LEFT

### P0 — Blocking correctness / usability
- [ ] Fix B2: change `exceptions.ts:103` to query `request_type = 'investigation_recommendation'` (or query both)
- [ ] Fix B3: verify `request_hash` on idempotency replay; return 409/422 on mismatch
- [ ] Fix B5: add `DELETE FROM idempotency_keys` and `DELETE FROM adjustments` to `seed.ts`

### P1 — Missing features (explicitly planned but absent)
- [ ] **Tests** — zero test files, zero test scripts, no test configs. Plan requires:
  - Unit tests (Phase 1): reconciliation, classification, balance calc
  - API integration tests (Phase 2): vitest + supertest, all endpoints + RBAC + idempotency
  - Agent tests (Phase 3): tool execution, rule-based fallback, LLM response validation
  - Worker tests (Phase 4): job lifecycle, retry, outbox publisher
- [ ] **Lint / format** — root `lint` script is a no-op; no ESLint or Prettier configs exist anywhere
- [ ] **`packages/config`** — directory exists but is empty; plan called for a dedicated env-config package
- [ ] **Real authentication** — currently header-only (`x-user-id` / `x-user-role`); `JWT_SECRET` is in `.env.example` but never read; no JWT/OIDC/session support
- [ ] **Notifications queue consumer** — `QUEUE_NOTIFICATIONS` is created and events are enqueued (`approval.requested`, `investigation.completed`) but **no worker consumes them**
- [ ] **`exception_rules` table** — created in `001_initial.sql` but never read or written; detection rules are hardcoded in `reconciliation.ts`; no rule CRUD or engine
- [ ] **`duplicate_payment` / `other` detection** — valid `ExceptionType` values handled by the agent but never emitted by `detectExceptions()`
- [ ] **Adjustments API/UI** — rows are written to `adjustments` by the action executor but there is no `GET /api/adjustments` endpoint and no page to view them
- [ ] **`GET /api/investigations` list** — only `GET /:id` exists; no list endpoint
- [ ] **Pagination / filtering** — `GET /jobs`, `GET /approvals`, `GET /audit` use fixed `LIMIT` (50/100) with no offset/cursor or filters

### P2 — Reliability / observability
- [ ] **Structured logging in API** — `pino` is a declared dependency of `apps/api` but unused; all logging is `console.*`
- [ ] **Request logging middleware** — no HTTP request/response logging
- [ ] **Compression** — plan listed it; not wired up
- [ ] **Rate limiting** — no rate limiter on any endpoint
- [ ] **Audit immutability** — `audit_logs` is a plain table; no `REVOKE UPDATE` / trigger / append-only enforcement
- [ ] **Idempotency hash enforcement** — see B3

### P3 — DevOps / deployment
- [ ] **CI pipeline** — no GitHub Actions / CI config
- [ ] **Auto-migrate on deploy** — compose does not run migrations or seed on startup; README instructs manual `docker compose exec`
- [ ] **Healthchecks for api/worker/web in compose** — only postgres and redis have healthchecks
- [ ] **Push to remote** — local commits are ahead of `origin/main`; work remains local

### P4 — Code hygiene (dead / unused code)
- [ ] `packages/shared/src/schemas.ts` — schemas never imported (routes define inline Zod schemas)
- [ ] `packages/queue` — `getInvestigationsQueue()` unused (worker constructs queues manually)
- [ ] `apps/api` — `pino` declared but unused
- [ ] `apps/web/src/lib/api.ts` — `getInvestigation()` helper unused
- [ ] `packages/agent/src/tools.ts` — `searchTransactions` defined but not referenced in rule-based path

### P5 — Agent hardening
- [x] Bundle exception, invoice, payment, and similar-exception context for the initial agent read
- [x] Cache similar-exception history briefly in Redis; bypass cache for current financial balances
- [x] Record duration, tool-call count, and cache hit/miss metrics in logs and audit metadata
- [x] Add a labeled replay/evaluation set on an isolated database to measure expected-action accuracy and latency by exception type
- [ ] Compare prompt/model versions and track regression history across saved evaluation reports
- [x] Add pgvector search for synthetic remittance notes; candidate matches require exact-data verification
- [ ] `stream` method on `LLMProvider` — plan mentioned streaming; interface only has `complete`
- [ ] LLM response retry / repair loop when Zod validation fails on the first attempt

---

## 5. Quick Reference

| Concern | File(s) |
|---|---|
| Schema + migrations | `packages/db/migrations/001_initial.sql`, `002_phase5.sql` |
| Migration runner | `packages/db/src/migrate.ts` |
| Exception detection | `packages/db/src/reconciliation.ts:110` |
| Rule-based fallback | `packages/agent/src/agent.ts:137` |
| Bundled context + Redis history cache | `packages/agent/src/tools.ts` |
| LLM tool loop | `packages/agent/src/agent.ts:80` |
| Investigation persistence | `packages/agent/src/investigate.ts` |
| Idempotency middleware | `apps/api/src/middleware/idempotency.ts` |
| RBAC middleware | `apps/api/src/middleware/rbac.ts` |
| Action executor | `apps/api/src/services/actions.ts` |
| Outbox publisher | `apps/worker/src/outboxPublisher.ts` |
| Investigation worker | `apps/worker/src/investigationWorker.ts` |
| Web exception detail | `apps/web/src/app/exceptions/[id]/page.tsx` |
