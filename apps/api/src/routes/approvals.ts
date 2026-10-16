import { Router } from 'express';
import { query, getClient } from '@cashflow/db';
import { asyncHandler, HttpError } from '../middleware/error';
import { requireRole, actorOf, AuthedRequest } from '../middleware/rbac';
import { executeRecommendation } from '../services/actions';
import { z } from 'zod';

export const approvalsRouter = Router();

const CreateSchema = z.object({
  request_type: z.string(),
  entity_id: z.number(),
  metadata: z.any().optional(),
});

const DecideSchema = z.object({
  status: z.enum(['approved', 'rejected']),
  rejected_reason: z.string().optional(),
});

approvalsRouter.get(
  '/',
  asyncHandler(async (_req, res) => {
    const rows = await query(
      'SELECT * FROM approvals ORDER BY id DESC LIMIT 50'
    );
    res.json({ data: rows });
  })
);

approvalsRouter.post(
  '/',
  requireRole('analyst'),
  asyncHandler(async (req: AuthedRequest, res) => {
    const body = CreateSchema.parse(req.body);
    const actor = actorOf(req);

    const rows = await query(
      `INSERT INTO approvals (request_type, entity_id, requested_by, status, metadata)
       VALUES ($1, $2, $3, 'pending', $4) RETURNING *`,
      [body.request_type, body.entity_id, actor, JSON.stringify(body.metadata ?? {})]
    );

    const audit = await getClient();
    try {
      await audit.query(
        `INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, changes) VALUES ($1, $2, $3, $4, $5)`,
        [actor, 'approval.created', 'approval', rows[0].id, JSON.stringify(body)]
      );
    } finally {
      audit.release();
    }

    res.status(201).json({ data: rows[0] });
  })
);

approvalsRouter.patch(
  '/:id',
  requireRole('approver'),
  asyncHandler(async (req: AuthedRequest, res) => {
    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id)) throw new HttpError(400, 'Invalid id');
    const body = DecideSchema.parse(req.body);
    const actor = actorOf(req);

    const rows = await query(
      `UPDATE approvals
       SET status = $1, approved_by = $2, approved_at = NOW(), rejected_reason = $3
       WHERE id = $4 AND status = 'pending'
       RETURNING *`,
      [body.status, actor, body.rejected_reason ?? null, id]
    );
    if (rows.length === 0) throw new HttpError(404, 'Approval not found or already decided');

    const approval = rows[0];
    let actionResult: unknown = null;

    if (body.status === 'approved' && approval.request_type === 'investigation_recommendation') {
      actionResult = await executeRecommendation(id, actor);
    } else if (body.status === 'rejected' && approval.request_type === 'investigation_recommendation') {
      await query(`UPDATE exceptions SET status = 'rejected' WHERE id = $1`, [approval.entity_id]);
    }

    const audit = await getClient();
    try {
      await audit.query(
        `INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, changes) VALUES ($1, $2, $3, $4, $5)`,
        [
          actor,
          `approval.${body.status}`,
          'approval',
          id,
          JSON.stringify({ rejected_reason: body.rejected_reason ?? null }),
        ]
      );
    } finally {
      audit.release();
    }

    res.json({ data: approval, action: actionResult });
  })
);
