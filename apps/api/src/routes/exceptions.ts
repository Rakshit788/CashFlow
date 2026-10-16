import { Router } from 'express';
import { query, getClient } from '@cashflow/db';
import { asyncHandler, HttpError } from '../middleware/error';
import { requireRole, actorOf, AuthedRequest } from '../middleware/rbac';
import { z } from 'zod';

export const exceptionsRouter = Router();

const ListQuerySchema = z.object({
  status: z.string().optional(),
  type: z.string().optional(),
  severity: z.string().optional(),
  customer_id: z.coerce.number().optional(),
  page: z.coerce.number().min(1).default(1),
  limit: z.coerce.number().min(1).max(100).default(20),
});

exceptionsRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const q = ListQuerySchema.parse(req.query);
    const conditions: string[] = [];
    const params: any[] = [];

    if (q.status) {
      params.push(q.status);
      conditions.push(`e.status = $${params.length}`);
    }
    if (q.type) {
      params.push(q.type);
      conditions.push(`e.type = $${params.length}`);
    }
    if (q.severity) {
      params.push(q.severity);
      conditions.push(`e.severity = $${params.length}`);
    }
    if (q.customer_id) {
      params.push(q.customer_id);
      conditions.push(`e.customer_id = $${params.length}`);
    }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const offset = (q.page - 1) * q.limit;
    params.push(q.limit, offset);

    const rows = await query(
      `SELECT e.*, c.name AS customer_name
       FROM exceptions e
       LEFT JOIN customers c ON c.id = e.customer_id
       ${where}
       ORDER BY e.detected_at DESC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );

    const countParams = params.slice(0, params.length - 2);
    const countRows = await query<{ count: string }>(
      `SELECT COUNT(*) AS count FROM exceptions e ${where}`,
      countParams
    );

    res.json({
      data: rows,
      page: q.page,
      limit: q.limit,
      total: parseInt(countRows[0].count, 10),
    });
  })
);

exceptionsRouter.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id)) throw new HttpError(400, 'Invalid id');

    const exceptionRows = await query(
      `SELECT e.*, c.name AS customer_name, c.customer_code
       FROM exceptions e
       LEFT JOIN customers c ON c.id = e.customer_id
       WHERE e.id = $1`,
      [id]
    );
    if (exceptionRows.length === 0) throw new HttpError(404, 'Exception not found');

    const exception = exceptionRows[0];

    const [invoices, payments, investigations, approvals] = await Promise.all([
      query(
        `SELECT i.*, COALESCE((SELECT SUM(ip.applied_amount) FROM invoice_payments ip WHERE ip.invoice_id = i.id), 0) AS applied,
                i.amount - COALESCE((SELECT SUM(ip.applied_amount) FROM invoice_payments ip WHERE ip.invoice_id = i.id), 0) AS outstanding
         FROM invoices i WHERE i.customer_id = $1`,
        [exception.customer_id]
      ),
      query(
        `SELECT p.*,
                COALESCE((SELECT SUM(ip.applied_amount) FROM invoice_payments ip WHERE ip.payment_id = p.id), 0) AS applied
         FROM payments p WHERE p.customer_id = $1`,
        [exception.customer_id]
      ),
      query('SELECT * FROM investigations WHERE exception_id = $1 ORDER BY requested_at DESC', [id]),
      query(
        `SELECT * FROM approvals WHERE request_type = 'exception' AND entity_id = $1 ORDER BY id DESC`,
        [id]
      ),
    ]);

    res.json({
      data: { ...exception, invoices, payments, investigations, approvals },
    });
  })
);

exceptionsRouter.post(
  '/:id/investigate',
  requireRole('analyst'),
  asyncHandler(async (req: AuthedRequest, res) => {
    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id)) throw new HttpError(400, 'Invalid id');

    const client = await getClient();
    try {
      await client.query('BEGIN');

      const exRows = await client.query('SELECT * FROM exceptions WHERE id = $1 FOR UPDATE', [id]);
      if (exRows.rows.length === 0) throw new HttpError(404, 'Exception not found');
      const exception = exRows.rows[0];

      if (exception.status === 'investigating') {
        throw new HttpError(409, 'Exception is already being investigated');
      }

      const requestedBy =
        actorOf(req) || (req.body?.requested_by as string) || 'system';

      const jobRes = await client.query(
        `INSERT INTO jobs (type, status, payload, priority, max_attempts)
         VALUES ('investigate_exception', 'waiting', $1, $2, $3) RETURNING id`,
        [JSON.stringify({ exceptionId: id }), 1, parseInt(process.env.MAX_JOB_ATTEMPTS || '5', 10)]
      );
      const jobId = jobRes.rows[0].id;

      const invRes = await client.query(
        `INSERT INTO investigations (exception_id, job_id, status, requested_by)
         VALUES ($1, $2, 'pending', $3) RETURNING *`,
        [id, jobId, requestedBy]
      );

      await client.query(`UPDATE exceptions SET status = 'investigating' WHERE id = $1`, [id]);

      await client.query(
        `INSERT INTO outbox (event_type, payload) VALUES ('investigation.requested', $1)`,
        [JSON.stringify({ exceptionId: id, jobId, investigationId: invRes.rows[0].id })]
      );

      await client.query(
        `INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, changes) VALUES ($1, $2, $3, $4, $5)`,
        [requestedBy, 'investigation.requested', 'exception', id, JSON.stringify({ jobId })]
      );

      await client.query('COMMIT');

      res.status(201).json({ data: { job: jobRes.rows[0], investigation: invRes.rows[0] } });
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  })
);

exceptionsRouter.post(
  '/:id/resolve',
  requireRole('analyst'),
  asyncHandler(async (req: AuthedRequest, res) => {
    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id)) throw new HttpError(400, 'Invalid id');

    const schema = z.object({ resolution_notes: z.string().optional() });
    const body = schema.parse(req.body ?? {});
    const actor = actorOf(req);

    const result = await query(
      `UPDATE exceptions
       SET status = 'resolved', resolved_at = NOW(), resolution_notes = $1
       WHERE id = $2 AND status <> 'resolved'
       RETURNING *`,
      [body.resolution_notes ?? null, id]
    );
    if (result.length === 0) throw new HttpError(404, 'Exception not found or already resolved');

    const auditClient = await getClient();
    try {
      await auditClient.query(
        `INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, changes) VALUES ($1, $2, $3, $4, $5)`,
        [actor, 'exception.resolved', 'exception', id, JSON.stringify(body)]
      );
    } finally {
      auditClient.release();
    }

    res.json({ data: result[0] });
  })
);
