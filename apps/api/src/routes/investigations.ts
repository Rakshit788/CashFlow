import { Router } from 'express';
import { query } from '@cashflow/db';
import { asyncHandler, HttpError } from '../middleware/error';

export const investigationsRouter = Router();

investigationsRouter.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id)) throw new HttpError(400, 'Invalid id');
    const rows = await query('SELECT * FROM investigations WHERE id = $1', [id]);
    if (rows.length === 0) throw new HttpError(404, 'Investigation not found');
    res.json({ data: rows[0] });
  })
);
