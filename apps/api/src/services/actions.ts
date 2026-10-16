import { query, getClient } from '@cashflow/db';

export interface SuggestedAdjustment {
  type: string;
  invoice_id?: number | null;
  payment_id?: number | null;
  amount?: number | null;
  note?: string;
}

export interface Recommendation {
  action: string;
  confidence: number;
  rationale: string;
  evidence_refs: string[];
  suggested_adjustments: SuggestedAdjustment[];
}

export interface ActionResult {
  approvalId: number;
  exceptionId: number;
  adjustments: number[];
  status: 'resolved';
}

/**
 * Simulated downstream action executor.
 * In a real system this would call the ERP / general ledger. Here we persist
 * adjustment records, resolve the exception and emit an outbox event.
 */
export async function executeRecommendation(
  approvalId: number,
  actor: string
): Promise<ActionResult> {
  const approvalRows = await query<{
    id: number;
    entity_id: number;
    metadata: Recommendation | null;
  }>('SELECT id, entity_id, metadata FROM approvals WHERE id = $1', [approvalId]);

  if (approvalRows.length === 0) {
    throw new Error(`Approval ${approvalId} not found`);
  }

  const approval = approvalRows[0];
  const exceptionId = approval.entity_id;
  const recommendation = approval.metadata;
  const adjustments = recommendation?.suggested_adjustments ?? [];

  const client = await getClient();
  const createdAdjustmentIds: number[] = [];
  try {
    await client.query('BEGIN');

    for (const adj of adjustments) {
      if (adj.type === 'noop') continue;
      const res = await client.query(
        `INSERT INTO adjustments
           (exception_id, approval_id, adjustment_type, invoice_id, payment_id, amount, note, status, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'applied', $8)
         RETURNING id`,
        [
          exceptionId,
          approvalId,
          adj.type,
          adj.invoice_id ?? null,
          adj.payment_id ?? null,
          adj.amount ?? null,
          adj.note ?? null,
          actor,
        ]
      );
      createdAdjustmentIds.push(res.rows[0].id);
    }

    await client.query(
      `UPDATE exceptions
       SET status = 'resolved', resolved_at = NOW(),
           resolution_notes = COALESCE(resolution_notes, $1)
       WHERE id = $2`,
      [`Resolved via approval #${approvalId} (${recommendation?.action ?? 'adjust'})`, exceptionId]
    );

    await client.query(
      `INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, changes)
       VALUES ($1, $2, $3, $4, $5)`,
      [
        actor,
        'action.executed',
        'exception',
        exceptionId,
        JSON.stringify({ approvalId, adjustments: createdAdjustmentIds }),
      ]
    );

    await client.query(
      `INSERT INTO outbox (event_type, payload) VALUES ('exception.resolved', $1)`,
      [JSON.stringify({ exceptionId, approvalId, adjustments: createdAdjustmentIds })]
    );

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  return {
    approvalId,
    exceptionId,
    adjustments: createdAdjustmentIds,
    status: 'resolved',
  };
}
