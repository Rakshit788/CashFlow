import { Router } from 'express';
import { query } from '@cashflow/db';
import { asyncHandler } from '../middleware/error';

export const auditRouter = Router();

auditRouter.get(
  '/',
  asyncHandler(async (_req, res) => {
    const rows = await query(
      'SELECT * FROM audit_logs ORDER BY created_at DESC LIMIT 100'
    );
    res.json({ data: rows });
  })
);
