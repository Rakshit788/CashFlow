import { pool, query } from '@cashflow/db';
import { createEmbeddings, toVectorLiteral } from './embeddings';

interface DemoCustomer {
  id: number;
  customer_code: string;
  name: string;
}

interface DemoDocument {
  suffix: string;
  text: (customerCode: string) => string;
}

const syntheticDocuments: DemoDocument[] = [
  {
    suffix: 'fuzzy-invoice-ref',
    text: (code) =>
      `Synthetic remittance advice for ${code}. The memo references invoice INV DEMO 1001 with spaces and missing separators. The payment note says March settlement; please match the invoice reference before allocating cash.`,
  },
  {
    suffix: 'multiple-invoices',
    text: (code) =>
      `Synthetic cash receipt note for ${code}. One bank transfer covers invoice INV-DEMO-2001 and invoice INV-DEMO-2002. Split the remittance across both invoices only after verifying the open balances.`,
  },
  {
    suffix: 'short-pay',
    text: (code) =>
      `Synthetic remittance from ${code}. Advice says short payment against invoice 3001 due to a freight deduction. The memo asks accounts receivable to review the deduction instead of writing it off automatically.`,
  },
];

async function indexSyntheticRemittanceDocuments(): Promise<void> {
  const customers = await query<DemoCustomer>(
    `SELECT id, customer_code, name
     FROM customers
     WHERE customer_code ~ '^CUST-00[1-5]$'
     ORDER BY customer_code`
  );

  if (customers.length !== 5 || customers.some((c, i) => c.name !== `Customer ${i + 1}`)) {
    throw new Error(
      'Refusing to embed database customer data. This command only indexes the five built-in synthetic seed customers.'
    );
  }

  const documents = customers.flatMap((customer) =>
    syntheticDocuments.map((document) => ({
      customerId: customer.id,
      sourceKey: `synthetic-${customer.customer_code}-${document.suffix}`,
      content: document.text(customer.customer_code),
    }))
  );

  let indexed = 0;
  for (let start = 0; start < documents.length; start += 32) {
    const batch = documents.slice(start, start + 32);
    const embeddings = await createEmbeddings(batch.map((document) => document.content));

    for (let index = 0; index < batch.length; index++) {
      const document = batch[index];
      await query(
        `INSERT INTO remittance_documents
           (customer_id, source_key, content, embedding, updated_at)
         VALUES ($1, $2, $3, $4::vector, NOW())
         ON CONFLICT (source_key) DO UPDATE SET
           customer_id = EXCLUDED.customer_id,
           content = EXCLUDED.content,
           embedding = EXCLUDED.embedding,
           updated_at = NOW()`,
        [document.customerId, document.sourceKey, document.content, toVectorLiteral(embeddings[index])]
      );
      indexed++;
    }
  }

  console.log(`Indexed ${indexed} synthetic remittance documents. No payment or invoice data was sent for embedding.`);
}

indexSyntheticRemittanceDocuments()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
