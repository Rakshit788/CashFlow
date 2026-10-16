import { randomUUID } from 'node:crypto';

interface EvaluationCase {
  id: string;
  description: string;
  exceptionType: string;
  invoiceAmount?: number;
  invoiceDueDate?: string;
  paymentAmount?: number;
  appliedAmount?: number;
  duplicatePayment?: boolean;
  expectedAction: string;
}

const cases: EvaluationCase[] = [
  {
    id: 'unapplied-with-open-invoice',
    description: 'Unapplied payment can be matched to an open invoice.',
    exceptionType: 'unapplied_payment',
    invoiceAmount: 500,
    paymentAmount: 250,
    expectedAction: 'adjust',
  },
  {
    id: 'partial-payment-mismatch',
    description: 'Partially applied payment has a remaining invoice balance.',
    exceptionType: 'amount_mismatch',
    invoiceAmount: 400,
    paymentAmount: 300,
    appliedAmount: 200,
    expectedAction: 'adjust',
  },
  {
    id: 'overpayment-credit',
    description: 'Payment total exceeds the customer invoice total.',
    exceptionType: 'overpayment',
    invoiceAmount: 500,
    paymentAmount: 700,
    expectedAction: 'hold',
  },
  {
    id: 'possible-duplicate-payment',
    description: 'Two same-value payments require a cautious hold.',
    exceptionType: 'duplicate_payment',
    invoiceAmount: 500,
    paymentAmount: 500,
    duplicatePayment: true,
    expectedAction: 'hold',
  },
  {
    id: 'past-due-invoice',
    description: 'Past-due balance should route to manual review/collections.',
    exceptionType: 'timing_issue',
    invoiceAmount: 300,
    invoiceDueDate: '2020-01-01',
    expectedAction: 'approve_manual',
  },
  {
    id: 'unapplied-without-open-invoice',
    description: 'Unapplied payment without an invoice should be held.',
    exceptionType: 'unapplied_payment',
    paymentAmount: 250,
    expectedAction: 'hold',
  },
  {
    id: 'unknown-exception',
    description: 'Unknown exception types should escalate for review.',
    exceptionType: 'other',
    expectedAction: 'approve_manual',
  },
];

interface CaseResult {
  caseId: string;
  description: string;
  exceptionType: string;
  expectedAction: string;
  actualAction: string | null;
  confidence: number | null;
  passed: boolean;
  provider?: string;
  model?: string;
  metrics?: unknown;
  evidenceCount: number;
  error?: string;
}

async function run(): Promise<void> {
  const evaluationUrl = process.env.EVALUATION_DATABASE_URL;
  if (!evaluationUrl) {
    throw new Error(
      'Set EVALUATION_DATABASE_URL to a dedicated evaluation database before running this command.'
    );
  }

  const databaseName = decodeURIComponent(new URL(evaluationUrl).pathname.split('/').pop() || '');
  if (!/eval/i.test(databaseName)) {
    throw new Error(
      `Refusing to write evaluation fixtures to database "${databaseName}". Its name must contain "eval".`
    );
  }

  // The DB package initializes its pool during import, so point it at the guarded URL first.
  process.env.DATABASE_URL = evaluationUrl;
  const { getClient, pool } = await import('@cashflow/db');
  const { runAgent } = await import('./agent');
  const previousThreshold = process.env.APPROVAL_THRESHOLD;
  process.env.APPROVAL_THRESHOLD = '1000';

  const runId = randomUUID().replace(/-/g, '').slice(0, 12);
  const results: CaseResult[] = [];
  const createdCustomerCodes: string[] = [];

  try {
    for (const evaluationCase of cases) {
      const customerCode = `EVAL-${runId}-${evaluationCase.id}`;
      createdCustomerCodes.push(customerCode);
      const client = await getClient();
      let exceptionId: number | null = null;

      try {
        await client.query('BEGIN');
        const customerResult = await client.query(
          `INSERT INTO customers (name, customer_code) VALUES ($1, $2) RETURNING id`,
          [`Evaluation ${evaluationCase.id}`, customerCode]
        );
        const customerId = customerResult.rows[0].id as number;

        let invoiceId: number | null = null;
        if (evaluationCase.invoiceAmount != null) {
          const invoiceResult = await client.query(
            `INSERT INTO invoices
               (customer_id, invoice_number, amount, currency, issue_date, due_date, status)
             VALUES ($1, $2, $3, 'USD', '2024-01-01', $4, 'open')
             RETURNING id`,
            [
              customerId,
              `${customerCode}-INV`,
              evaluationCase.invoiceAmount,
              evaluationCase.invoiceDueDate ?? '2099-01-01',
            ]
          );
          invoiceId = invoiceResult.rows[0].id as number;
        }

        let paymentId: number | null = null;
        if (evaluationCase.paymentAmount != null) {
          const paymentResult = await client.query(
            `INSERT INTO payments
               (customer_id, payment_ref, amount, currency, payment_date, method)
             VALUES ($1, $2, $3, 'USD', '2024-02-01', 'ACH')
             RETURNING id`,
            [customerId, `${customerCode}-PAY-1`, evaluationCase.paymentAmount]
          );
          paymentId = paymentResult.rows[0].id as number;

          if (evaluationCase.duplicatePayment) {
            await client.query(
              `INSERT INTO payments
                 (customer_id, payment_ref, amount, currency, payment_date, method)
               VALUES ($1, $2, $3, 'USD', '2024-02-02', 'ACH')`,
              [customerId, `${customerCode}-PAY-2`, evaluationCase.paymentAmount]
            );
          }

          if (invoiceId != null && evaluationCase.appliedAmount != null) {
            await client.query(
              `INSERT INTO invoice_payments (invoice_id, payment_id, applied_amount)
               VALUES ($1, $2, $3)`,
              [invoiceId, paymentId, evaluationCase.appliedAmount]
            );
          }
        }

        const exceptionResult = await client.query(
          `INSERT INTO exceptions
             (type, status, severity, customer_id, invoice_id, payment_id, reason, amount_delta)
           VALUES ($1, 'open', 'medium', $2, $3, $4, $5, $6)
           RETURNING id`,
          [
            evaluationCase.exceptionType,
            customerId,
            invoiceId,
            paymentId,
            evaluationCase.description,
            evaluationCase.paymentAmount ?? evaluationCase.invoiceAmount ?? 0,
          ]
        );
        exceptionId = exceptionResult.rows[0].id as number;
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }

      try {
        if (exceptionId === null) throw new Error('Evaluation exception was not created');
        const result = await runAgent(exceptionId);
        const passed = result.recommendation.action === evaluationCase.expectedAction;
        results.push({
          caseId: evaluationCase.id,
          description: evaluationCase.description,
          exceptionType: evaluationCase.exceptionType,
          expectedAction: evaluationCase.expectedAction,
          actualAction: result.recommendation.action,
          confidence: result.recommendation.confidence,
          passed,
          provider: result.provider,
          model: result.model,
          metrics: result.metrics,
          evidenceCount: result.evidence.length,
        });
      } catch (error) {
        results.push({
          caseId: evaluationCase.id,
          description: evaluationCase.description,
          exceptionType: evaluationCase.exceptionType,
          expectedAction: evaluationCase.expectedAction,
          actualAction: null,
          confidence: null,
          passed: false,
          evidenceCount: 0,
          error: error instanceof Error ? error.message : String(error),
        });
      } finally {
        const cleanup = await getClient();
        try {
          await cleanup.query('BEGIN');
          await cleanup.query(
            `DELETE FROM invoice_payments WHERE invoice_id IN
               (SELECT id FROM invoices WHERE customer_id IN
                 (SELECT id FROM customers WHERE customer_code = $1))
             OR payment_id IN (SELECT id FROM payments WHERE customer_id IN
                 (SELECT id FROM customers WHERE customer_code = $1))`,
            [customerCode]
          );
          await cleanup.query(
            `DELETE FROM exceptions WHERE customer_id IN
               (SELECT id FROM customers WHERE customer_code = $1)`,
            [customerCode]
          );
          await cleanup.query(
            `DELETE FROM payments WHERE customer_id IN
               (SELECT id FROM customers WHERE customer_code = $1)`,
            [customerCode]
          );
          await cleanup.query(
            `DELETE FROM invoices WHERE customer_id IN
               (SELECT id FROM customers WHERE customer_code = $1)`,
            [customerCode]
          );
          await cleanup.query('DELETE FROM customers WHERE customer_code = $1', [customerCode]);
          await cleanup.query('COMMIT');
        } catch (error) {
          await cleanup.query('ROLLBACK');
          throw error;
        } finally {
          cleanup.release();
        }
      }
    }

    const passed = results.filter((result) => result.passed).length;
    const byType = Object.fromEntries(
      [...new Set(results.map((result) => result.exceptionType))].map((type) => {
        const group = results.filter((result) => result.exceptionType === type);
        return [type, { passed: group.filter((result) => result.passed).length, total: group.length }];
      })
    );
    console.log(
      JSON.stringify(
        {
          runId,
          evaluationSetVersion: 'cashflow-agent-v1',
          generatedAt: new Date().toISOString(),
          database: databaseName,
          summary: { passed, total: results.length, accuracy: passed / results.length },
          byType,
          cases: results,
        },
        null,
        2
      )
    );
  } finally {
    if (previousThreshold === undefined) delete process.env.APPROVAL_THRESHOLD;
    else process.env.APPROVAL_THRESHOLD = previousThreshold;
    // Retry cleanup if a case setup or execution aborted before its local cleanup.
    for (const customerCode of createdCustomerCodes) {
      const cleanup = await getClient();
      try {
        await cleanup.query('BEGIN');
        await cleanup.query(
          `DELETE FROM invoice_payments WHERE invoice_id IN
             (SELECT id FROM invoices WHERE customer_id IN
               (SELECT id FROM customers WHERE customer_code = $1))
           OR payment_id IN (SELECT id FROM payments WHERE customer_id IN
               (SELECT id FROM customers WHERE customer_code = $1))`,
          [customerCode]
        );
        await cleanup.query(
          `DELETE FROM exceptions WHERE customer_id IN
             (SELECT id FROM customers WHERE customer_code = $1)`,
          [customerCode]
        );
        await cleanup.query(
          `DELETE FROM payments WHERE customer_id IN
             (SELECT id FROM customers WHERE customer_code = $1)`,
          [customerCode]
        );
        await cleanup.query(
          `DELETE FROM invoices WHERE customer_id IN
             (SELECT id FROM customers WHERE customer_code = $1)`,
          [customerCode]
        );
        await cleanup.query('DELETE FROM customers WHERE customer_code = $1', [customerCode]);
        await cleanup.query('COMMIT');
      } catch {
        await cleanup.query('ROLLBACK');
      } finally {
        cleanup.release();
      }
    }
    await pool.end();
  }
}

run().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
