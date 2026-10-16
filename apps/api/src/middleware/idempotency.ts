import { Request, Response, NextFunction } from 'express';
import { createHash } from 'crypto';
import { query } from '@cashflow/db';

const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

interface IdempotencyRow {
  key: string;
  response_status: number;
  response_body: unknown;
}

function hashBody(body: unknown): string {
  return createHash('sha256')
    .update(JSON.stringify(body ?? {}))
    .digest('hex');
}

async function findKey(key: string): Promise<IdempotencyRow | undefined> {
  const rows = await query<IdempotencyRow>(
    'SELECT key, response_status, response_body FROM idempotency_keys WHERE key = $1',
    [key]
  );
  return rows[0];
}

export async function idempotency(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  if (!WRITE_METHODS.has(req.method)) {
    next();
    return;
  }

  const key = req.header('idempotency-key');
  if (!key) {
    next();
    return;
  }

  const endpoint = `${req.method} ${req.baseUrl}${req.path}`;
  const requestHash = hashBody(req.body);

  try {
    const existing = await findKey(key);
    if (existing) {
      if (existing.response_status > 0) {
        res.status(existing.response_status).json(existing.response_body);
        return;
      }
      res.status(409).json({ error: 'A request with this idempotency key is still in progress' });
      return;
    }

    const claimed = await query(
      `INSERT INTO idempotency_keys (key, endpoint, request_hash, response_status)
       VALUES ($1, $2, $3, 0)
       ON CONFLICT (key) DO NOTHING
       RETURNING key`,
      [key, endpoint, requestHash]
    );

    if (claimed.length === 0) {
      const raced = await findKey(key);
      if (raced && raced.response_status > 0) {
        res.status(raced.response_status).json(raced.response_body);
        return;
      }
      res.status(409).json({ error: 'A request with this idempotency key is still in progress' });
      return;
    }

    const originalJson = res.json.bind(res);
    res.json = (body: unknown) => {
      void query(
        `UPDATE idempotency_keys SET response_status = $1, response_body = $2 WHERE key = $3`,
        [res.statusCode, JSON.stringify(body ?? null), key]
      ).catch(() => undefined);
      return originalJson(body);
    };

    next();
  } catch (err) {
    next(err);
  }
}
