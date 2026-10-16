# Interview Preparation Notes

Talking points for walking through the CashFlow design.

## The problem

Cash application teams reconcile incoming payments against outstanding invoices. Mismatches
(partial payments, unapplied cash, duplicates, overpayments, timing gaps) create exceptions
that are expensive to investigate manually. CashFlow automates detection and investigation
and keeps a human in the loop for anything risky.

## Design decisions & trade-offs

### Transactional outbox instead of direct enqueue
The API never talks to Redis during a write. It writes the state change *and* an outbox
event in the same DB transaction; a worker poller relays events to BullMQ with
`FOR UPDATE SKIP LOCKED`. This gives **atomicity** and **at-least-once delivery** even if
Redis is down when the request arrives, at the cost of a small publish latency.
- Trade-off: at-least-once means duplicates are possible → workers are idempotent.

### Idempotent write endpoints
`Idempotency-Key` rows are claimed with `INSERT ... ON CONFLICT DO NOTHING`, the response is
captured, and replays return the stored response. Concurrent duplicates get `409`. This makes
retries from mobile/flaky clients safe.

### Idempotent workers
The DB `jobs` row is the source of truth. A worker skips an already-completed job, so
redelivered queue messages can't double-apply work.

### Agent with a tool loop + structured output
Instead of asking the LLM for a one-shot answer, the agent calls domain tools
(`getExceptionDetails`, `getCustomerInvoices`, `getInvoicePayments`, `calculateBalances`,
`getSimilarExceptions`, …) and must return strict JSON that is validated with Zod. Every tool
call and result is recorded as **evidence**, so each claim in the rationale is auditable.

### Rule-based fallback
LLM providers are abstracted behind `LLMProvider`. When no API key is configured, a
deterministic rule-based agent runs the same tools and produces the same structured
recommendation. This keeps demos and tests hermetic and cheap, and protects against provider
outages.

### Agent context latency and cache boundaries
The agent starts with one `getInvestigationContext` tool that fetches the current exception,
invoice balances, payment balances, and similar exceptions together. Independent PostgreSQL
reads run concurrently. Redis caches only similar-exception history for 15 seconds; current
invoice, allocation, and balance data always comes from PostgreSQL. A cache outage is treated
as a miss and never blocks the investigation. Each run records duration, tool-call count, and
cache hit/miss counts in the completion audit event and worker log.

### Human-in-the-loop approvals
Only `release` auto-resolves. Adjustments, holds, and amounts above `APPROVAL_THRESHOLD`
become `approvals` requiring an approver. The action executor (simulated ERP integration)
runs only after approval.

### RBAC as middleware
`viewer < analyst < approver < admin`. Route-level `requireRole(...)` keeps authorization
declarative and testable. Identity is header-based for demo simplicity — swap for JWT/OIDC
without touching handlers.

## Scalability / production notes

- API and workers scale independently; BullMQ concurrency is configurable.
- The outbox poller can run as a single leader (or use `SKIP LOCKED` safely with several).
- Migrations are plain SQL and versioned via the `migrations` table.
- Structured logging via Pino; health endpoint for orchestrators.
- Real deployment would add JWT auth, rate limiting, secrets management, and a real
  downstream actions adapter.

## Likely questions

- **Why not enqueue directly from the API?** Reliability: DB commit and event commit are
  atomic; Redis outages don't lose work.
- **How do you avoid duplicate investigations?** Idempotency keys on the request,
  deterministic BullMQ job ids (`db-<jobId>`), and the job-status guard in the worker.
- **How is hallucination controlled?** Tools ground the model in real data; output is schema
  validated; evidence is persisted; low-confidence/ambiguous cases route to manual review.
- **What's auto vs. manual?** Only `release` auto-resolves; everything else needs approval.
