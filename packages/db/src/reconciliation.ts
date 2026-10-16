import { query, getClient, pool } from './db';

export async function getOutstandingBalance(invoiceId: number): Promise<number> {
  const rows = await query<{ balance: string }>(
    `SELECT i.amount - COALESCE(SUM(ip.applied_amount), 0) AS balance
     FROM invoices i
     LEFT JOIN invoice_payments ip ON ip.invoice_id = i.id
     WHERE i.id = $1
     GROUP BY i.id, i.amount`,
    [invoiceId]
  );
  if (rows.length === 0) throw new Error(`Invoice ${invoiceId} not found`);
  return parseFloat(rows[0].balance);
}

export interface ExceptionCandidate {
  type: string;
  severity: 'low' | 'medium' | 'high';
  reason: string;
  customer_id: number;
  invoice_id?: number;
  payment_id?: number;
  amount_delta?: number;
  outstanding_balance_snapshot?: number;
}

export async function classifyCustomer(customerId: number): Promise<ExceptionCandidate[]> {
  const candidates: ExceptionCandidate[] = [];

  const invoices = await query<{ id: number; amount: string; due_date: string | null }>(
    'SELECT id, amount, due_date FROM invoices WHERE customer_id = $1',
    [customerId]
  );

  const payments = await query<{ id: number; amount: string }>(
    'SELECT id, amount FROM payments WHERE customer_id = $1',
    [customerId]
  );

  const allocations = await query<{ payment_id: number; total: string }>(
    `SELECT payment_id, SUM(applied_amount) AS total
     FROM invoice_payments ip
     JOIN invoices i ON i.id = ip.invoice_id
     WHERE i.customer_id = $1
     GROUP BY payment_id`,
    [customerId]
  );

  const appliedByPayment = new Map<number, number>();
  for (const a of allocations) {
    appliedByPayment.set(a.payment_id, parseFloat(a.total));
  }

  // Unapplied payment: payment fully unused
  for (const p of payments) {
    const applied = appliedByPayment.get(p.id) ?? 0;
    if (applied === 0) {
      candidates.push({
        type: 'unapplied_payment',
        severity: 'medium',
        reason: `Payment ${p.id} of ${p.amount} has no invoice allocations`,
        customer_id: customerId,
        payment_id: p.id,
        amount_delta: parseFloat(p.amount),
      });
    } else if (applied < parseFloat(p.amount) * 0.999) {
      candidates.push({
        type: 'amount_mismatch',
        severity: 'medium',
        reason: `Payment ${p.id} of ${p.amount} partially applied (${applied})`,
        customer_id: customerId,
        payment_id: p.id,
        amount_delta: parseFloat(p.amount) - applied,
      });
    }
  }

  // Overpayment: total payments exceed total invoices
  const totalPayments = payments.reduce((s, p) => s + parseFloat(p.amount), 0);
  const totalInvoices = invoices.reduce((s, i) => s + parseFloat(i.amount), 0);
  if (totalPayments > totalInvoices + 0.01) {
    candidates.push({
      type: 'overpayment',
      severity: 'high',
      reason: `Customer paid ${totalPayments.toFixed(2)} against invoices totaling ${totalInvoices.toFixed(2)}`,
      customer_id: customerId,
      amount_delta: totalPayments - totalInvoices,
    });
  }

  // Invoice with zero payments but past due
  for (const inv of invoices) {
    const balance = await getOutstandingBalance(inv.id);
    if (balance > 0.01 && inv.due_date && new Date(inv.due_date) < new Date()) {
      candidates.push({
        type: 'timing_issue',
        severity: balance > 1000 ? 'high' : 'low',
        reason: `Invoice ${inv.id} past due with outstanding balance ${balance.toFixed(2)}`,
        customer_id: customerId,
        invoice_id: inv.id,
        amount_delta: balance,
        outstanding_balance_snapshot: balance,
      });
    }
  }

  return candidates;
}

export async function detectExceptions(): Promise<number> {
  const customers = await query<{ id: number }>('SELECT id FROM customers');
  const client = await getClient();
  let inserted = 0;
  try {
    await client.query('BEGIN');
    for (const c of customers) {
      const candidates = await classifyCustomer(c.id);
      for (const cand of candidates) {
        const exists = await client.query(
          `SELECT id FROM exceptions
           WHERE customer_id = $1
             AND type = $2
             AND COALESCE(invoice_id, 0) = COALESCE($3, 0)
             AND COALESCE(payment_id, 0) = COALESCE($4, 0)
             AND status IN ('open', 'investigating')`,
          [cand.customer_id, cand.type, cand.invoice_id ?? null, cand.payment_id ?? null]
        );
        if (exists.rows.length > 0) continue;

        await client.query(
          `INSERT INTO exceptions (type, status, severity, customer_id, invoice_id, payment_id, reason, amount_delta, outstanding_balance_snapshot)
           VALUES ($1, 'open', $2, $3, $4, $5, $6, $7, $8)`,
          [
            cand.type,
            cand.severity,
            cand.customer_id,
            cand.invoice_id ?? null,
            cand.payment_id ?? null,
            cand.reason,
            cand.amount_delta ?? null,
            cand.outstanding_balance_snapshot ?? null,
          ]
        );
        inserted++;
      }
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
  return inserted;
}

if (require.main === module) {
  detectExceptions()
    .then((n) => {
      console.log(`Detected ${n} new exceptions`);
      return pool.end();
    })
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
