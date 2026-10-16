import { pool } from './db';

function randomInt(min: number, max: number) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function randomAmount(min: number, max: number) {
  return parseFloat((Math.random() * (max - min) + min).toFixed(2));
}

export async function seed() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    await client.query('DELETE FROM outbox');
    await client.query('DELETE FROM approvals');
    await client.query('DELETE FROM audit_logs');
    await client.query('DELETE FROM investigations');
    await client.query('DELETE FROM jobs');
    await client.query('DELETE FROM exceptions');
    await client.query('DELETE FROM invoice_payments');
    await client.query('DELETE FROM payments');
    await client.query('DELETE FROM invoices');
    await client.query('DELETE FROM customers');
    await client.query('DELETE FROM exception_rules');

    await client.query("SELECT setval('customers_id_seq', 1, false)");
    await client.query("SELECT setval('invoices_id_seq', 1, false)");
    await client.query("SELECT setval('payments_id_seq', 1, false)");
    await client.query("SELECT setval('invoice_payments_id_seq', 1, false)");
    await client.query("SELECT setval('exceptions_id_seq', 1, false)");

    const customers = [];
    for (let i = 1; i <= 5; i++) {
      const res = await client.query(
        'INSERT INTO customers (name, customer_code) VALUES ($1, $2) RETURNING id',
        [`Customer ${i}`, `CUST-${String(i).padStart(3, '0')}`]
      );
      customers.push({ id: res.rows[0].id, code: `CUST-${String(i).padStart(3, '0')}` });
    }

    for (let c = 0; c < customers.length; c++) {
      const cust = customers[c];
      const invoiceCount = randomInt(2, 4);
      const invoices: { id: number; amount: number }[] = [];
      for (let i = 0; i < invoiceCount; i++) {
        const amount = randomAmount(100, 5000);
        const issue = new Date();
        issue.setDate(issue.getDate() - randomInt(5, 30));
        const due = new Date(issue);
        due.setDate(due.getDate() + 30);
        const invRes = await client.query(
          'INSERT INTO invoices (customer_id, invoice_number, amount, currency, issue_date, due_date, status) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id, amount',
          [
            cust.id,
            `INV-${cust.code}-${i + 1}-${Date.now() % 10000}`,
            amount,
            'USD',
            issue.toISOString().split('T')[0],
            due.toISOString().split('T')[0],
            'open',
          ]
        );
        invoices.push({ id: invRes.rows[0].id, amount: parseFloat(invRes.rows[0].amount) });
      }

      const payCount = randomInt(1, invoiceCount + 1);
      for (let p = 0; p < payCount; p++) {
        const payAmount = randomAmount(50, 3000);
        const payDate = new Date();
        payDate.setDate(payDate.getDate() - randomInt(0, 10));
        const payRes = await client.query(
          'INSERT INTO payments (customer_id, payment_ref, amount, currency, payment_date, method) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id, amount',
          [
            cust.id,
            `PAY-${cust.code}-${p + 1}-${Date.now() % 10000}`,
            payAmount,
            'USD',
            payDate.toISOString().split('T')[0],
            'ACH',
          ]
        );
        const pay = { id: payRes.rows[0].id, amount: parseFloat(payRes.rows[0].amount) };

        if (invoices.length > 0) {
          const inv = invoices[0];
          const apply = Math.min(pay.amount, inv.amount * 0.5);
          if (apply > 0) {
            await client.query(
              'INSERT INTO invoice_payments (invoice_id, payment_id, applied_amount) VALUES ($1, $2, $3)',
              [inv.id, pay.id, apply.toFixed(2)]
            );
          }
        }
      }
    }

    await client.query('COMMIT');
    console.log('Seed complete');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

if (require.main === module) {
  seed().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
