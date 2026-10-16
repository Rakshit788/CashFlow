import { query } from '@cashflow/db';
import type { AgentCache } from './types';

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export const toolDefinitions: ToolDefinition[] = [
  {
    name: 'getInvestigationContext',
    description:
      'Get the current exception, the customer invoices and payments, and recent similar exceptions in one call. Use this first for a complete grounded investigation context.',
    parameters: {
      type: 'object',
      properties: { exceptionId: { type: 'number' } },
      required: ['exceptionId'],
    },
  },
  {
    name: 'getExceptionDetails',
    description:
      'Get the full context of an exception including customer, invoice, payment, status, reason and amount delta.',
    parameters: {
      type: 'object',
      properties: { exceptionId: { type: 'number' } },
      required: ['exceptionId'],
    },
  },
  {
    name: 'getCustomerInvoices',
    description: 'List recent invoices for a customer with their outstanding balances.',
    parameters: {
      type: 'object',
      properties: {
        customerId: { type: 'number' },
        limit: { type: 'number' },
      },
      required: ['customerId'],
    },
  },
  {
    name: 'getInvoicePayments',
    description: 'List payment allocations applied to a specific invoice.',
    parameters: {
      type: 'object',
      properties: { invoiceId: { type: 'number' } },
      required: ['invoiceId'],
    },
  },
  {
    name: 'getCustomerPayments',
    description: 'List recent payments for a customer with how much of each has been applied.',
    parameters: {
      type: 'object',
      properties: {
        customerId: { type: 'number' },
        limit: { type: 'number' },
      },
      required: ['customerId'],
    },
  },
  {
    name: 'searchTransactions',
    description:
      'Flexible search across customers, invoices and payments by a free-text query (name, code, invoice number, payment ref).',
    parameters: {
      type: 'object',
      properties: { query: { type: 'string' } },
      required: ['query'],
    },
  },
  {
    name: 'calculateBalances',
    description: 'Recompute the outstanding balance for an invoice from its allocations.',
    parameters: {
      type: 'object',
      properties: { invoiceId: { type: 'number' } },
      required: ['invoiceId'],
    },
  },
  {
    name: 'getSimilarExceptions',
    description: 'Find other exceptions of the same type for the same customer to spot patterns.',
    parameters: {
      type: 'object',
      properties: { exceptionId: { type: 'number' } },
      required: ['exceptionId'],
    },
  },
];

export async function executeTool(
  name: string,
  args: Record<string, unknown>,
  cache?: AgentCache,
  cacheStats?: { hits: number; misses: number }
): Promise<unknown> {
  switch (name) {
    case 'getInvestigationContext': {
      const exceptionRows = await query<{
        id: number;
        type: string;
        customer_id: number;
        [key: string]: unknown;
      }>(
        `SELECT e.*, c.name AS customer_name, c.customer_code
         FROM exceptions e
         LEFT JOIN customers c ON c.id = e.customer_id
         WHERE e.id = $1`,
        [args.exceptionId]
      );
      const exception = exceptionRows[0];
      if (!exception) return { error: 'not_found' };

      const cacheKey = `cashflow:agent:similar:${exception.customer_id}:${exception.type}`;
      let similarExceptions: unknown[] | null = null;
      if (cache) {
        try {
          const cached = await cache.get(cacheKey);
          if (cached) {
            similarExceptions = JSON.parse(cached) as unknown[];
            if (cacheStats) cacheStats.hits += 1;
          } else if (cacheStats) {
            cacheStats.misses += 1;
          }
        } catch {
          // Redis is an optimization. A cache outage must not block an investigation.
          if (cacheStats) cacheStats.misses += 1;
        }
      }

      const similarExceptionsQuery =
        similarExceptions !== null
          ? Promise.resolve(similarExceptions)
          : query(
              `SELECT id, type, status, severity, reason, amount_delta, detected_at
               FROM exceptions
               WHERE type = $1 AND customer_id = $2 AND id <> $3
               ORDER BY detected_at DESC
               LIMIT 10`,
              [exception.type, exception.customer_id, exception.id]
            );
      const shouldCacheSimilarExceptions = cache !== undefined && similarExceptions === null;

      const [invoices, payments, queriedSimilarExceptions] = await Promise.all([
        query(
          `SELECT i.id, i.invoice_number, i.amount, i.currency, i.issue_date, i.due_date, i.status,
                  COALESCE(SUM(ip.applied_amount), 0) AS applied,
                  i.amount - COALESCE(SUM(ip.applied_amount), 0) AS outstanding
           FROM invoices i
           LEFT JOIN invoice_payments ip ON ip.invoice_id = i.id
           WHERE i.customer_id = $1
           GROUP BY i.id
           ORDER BY i.issue_date DESC
           LIMIT 20`,
          [exception.customer_id]
        ),
        query(
          `SELECT p.id, p.payment_ref, p.amount, p.currency, p.payment_date, p.method,
                  COALESCE(SUM(ip.applied_amount), 0) AS applied,
                  p.amount - COALESCE(SUM(ip.applied_amount), 0) AS unapplied
           FROM payments p
           LEFT JOIN invoice_payments ip ON ip.payment_id = p.id
           WHERE p.customer_id = $1
           GROUP BY p.id
           ORDER BY p.payment_date DESC
           LIMIT 20`,
          [exception.customer_id]
        ),
        similarExceptionsQuery,
      ]);

      similarExceptions = queriedSimilarExceptions;
      if (cache && shouldCacheSimilarExceptions) {
        try {
          await cache.set(cacheKey, JSON.stringify(similarExceptions), 15);
        } catch {
          // Ignore cache write failures; PostgreSQL remains the source of truth.
        }
      }

      return {
        exception,
        invoices,
        payments,
        similarExceptions,
      };
    }
    case 'getExceptionDetails': {
      const rows = await query(
        `SELECT e.*, c.name AS customer_name, c.customer_code
         FROM exceptions e
         LEFT JOIN customers c ON c.id = e.customer_id
         WHERE e.id = $1`,
        [args.exceptionId]
      );
      return rows[0] ?? { error: 'not_found' };
    }
    case 'getCustomerInvoices': {
      const limit = typeof args.limit === 'number' ? args.limit : 20;
      return query(
        `SELECT i.id, i.invoice_number, i.amount, i.currency, i.issue_date, i.due_date, i.status,
                COALESCE(SUM(ip.applied_amount), 0) AS applied,
                i.amount - COALESCE(SUM(ip.applied_amount), 0) AS outstanding
         FROM invoices i
         LEFT JOIN invoice_payments ip ON ip.invoice_id = i.id
         WHERE i.customer_id = $1
         GROUP BY i.id
         ORDER BY i.issue_date DESC
         LIMIT $2`,
        [args.customerId, limit]
      );
    }
    case 'getInvoicePayments': {
      return query(
        `SELECT ip.id, ip.invoice_id, ip.payment_id, ip.applied_amount, ip.applied_at,
                p.payment_ref, p.amount AS payment_amount, p.payment_date
         FROM invoice_payments ip
         JOIN payments p ON p.id = ip.payment_id
         WHERE ip.invoice_id = $1
         ORDER BY ip.applied_at`,
        [args.invoiceId]
      );
    }
    case 'getCustomerPayments': {
      const limit = typeof args.limit === 'number' ? args.limit : 20;
      return query(
        `SELECT p.id, p.payment_ref, p.amount, p.currency, p.payment_date, p.method,
                COALESCE(SUM(ip.applied_amount), 0) AS applied,
                p.amount - COALESCE(SUM(ip.applied_amount), 0) AS unapplied
         FROM payments p
         LEFT JOIN invoice_payments ip ON ip.payment_id = p.id
         WHERE p.customer_id = $1
         GROUP BY p.id
         ORDER BY p.payment_date DESC
         LIMIT $2`,
        [args.customerId, limit]
      );
    }
    case 'searchTransactions': {
      const q = `%${String(args.query ?? '')}%`;
      const [customers, invoices, payments] = await Promise.all([
        query(`SELECT id, name, customer_code FROM customers WHERE name ILIKE $1 OR customer_code ILIKE $1 LIMIT 10`, [q]),
        query(`SELECT id, customer_id, invoice_number, amount, status FROM invoices WHERE invoice_number ILIKE $1 LIMIT 10`, [q]),
        query(`SELECT id, customer_id, payment_ref, amount, payment_date FROM payments WHERE payment_ref ILIKE $1 LIMIT 10`, [q]),
      ]);
      return { customers, invoices, payments };
    }
    case 'calculateBalances': {
      const rows = await query<{ invoice_id: number; amount: string; applied: string; outstanding: string }>(
        `SELECT i.id AS invoice_id, i.amount,
                COALESCE(SUM(ip.applied_amount), 0) AS applied,
                i.amount - COALESCE(SUM(ip.applied_amount), 0) AS outstanding
         FROM invoices i
         LEFT JOIN invoice_payments ip ON ip.invoice_id = i.id
         WHERE i.id = $1
         GROUP BY i.id`,
        [args.invoiceId]
      );
      return rows[0] ?? { error: 'not_found' };
    }
    case 'getSimilarExceptions': {
      const base = await query<{ type: string; customer_id: number }>(
        'SELECT type, customer_id FROM exceptions WHERE id = $1',
        [args.exceptionId]
      );
      if (base.length === 0) return [];
      return query(
        `SELECT id, type, status, severity, reason, amount_delta, detected_at
         FROM exceptions
         WHERE type = $1 AND customer_id = $2 AND id <> $3
         ORDER BY detected_at DESC
         LIMIT 10`,
        [base[0].type, base[0].customer_id, args.exceptionId]
      );
    }
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}
