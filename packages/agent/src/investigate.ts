import { getClient, query } from '@cashflow/db';
import { runAgent, RunAgentOptions } from './agent';
import { AgentRunResult } from './types';

export interface InvestigationOutcome extends AgentRunResult {
  exceptionId: number;
  investigationId: number | null;
  nextStatus: 'resolved' | 'pending_approval';
  approvalId: number | null;
}

export async function runInvestigation(
  exceptionId: number,
  jobId?: number,
  options: RunAgentOptions = {}
): Promise<InvestigationOutcome> {
  const exceptionRows = await query('SELECT * FROM exceptions WHERE id = $1', [exceptionId]);
  if (exceptionRows.length === 0) {
    throw new Error(`Exception ${exceptionId} not found`);
  }

  const result = await runAgent(exceptionId, options);
  const rec = result.recommendation;

  const autoResolvable = rec.action === 'release';

  const client = await getClient();
  try {
    await client.query('BEGIN');

    const invUpdate =
      jobId != null
        ? await client.query(
            `UPDATE investigations
             SET status = 'completed', completed_at = NOW(), result = $1, evidence = $2
             WHERE job_id = $3
             RETURNING id`,
            [JSON.stringify(rec), JSON.stringify(result.evidence), jobId]
          )
        : await client.query(
            `UPDATE investigations
             SET status = 'completed', completed_at = NOW(), result = $1, evidence = $2
             WHERE id = (
               SELECT id FROM investigations WHERE exception_id = $3
               ORDER BY requested_at DESC LIMIT 1
             )
             RETURNING id`,
            [JSON.stringify(rec), JSON.stringify(result.evidence), exceptionId]
          );

    const investigationId = invUpdate.rows[0]?.id ?? null;

    let approvalId: number | null = null;
    const nextStatus: 'resolved' | 'pending_approval' = autoResolvable
      ? 'resolved'
      : 'pending_approval';

    if (autoResolvable) {
      await client.query(
        `UPDATE exceptions
         SET status = 'resolved', resolved_at = NOW(),
             resolution_notes = COALESCE(resolution_notes, $1)
         WHERE id = $2`,
        [`Auto-resolved by AI agent (${rec.action})`, exceptionId]
      );
    } else {
      await client.query(`UPDATE exceptions SET status = 'pending_approval' WHERE id = $1`, [
        exceptionId,
      ]);

      const approval = await client.query(
        `INSERT INTO approvals (request_type, entity_id, requested_by, status, metadata)
         VALUES ('investigation_recommendation', $1, $2, 'pending', $3)
         RETURNING id`,
        [exceptionId, result.provider, JSON.stringify(rec)]
      );
      approvalId = approval.rows[0].id;

      await client.query(
        `INSERT INTO outbox (event_type, payload) VALUES ('approval.requested', $1)`,
        [JSON.stringify({ approvalId, exceptionId, recommendation: rec })]
      );
    }

    await client.query(
      `INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, changes)
       VALUES ($1, $2, $3, $4, $5)`,
      [
        result.provider,
        'investigation.completed',
        'exception',
        exceptionId,
        JSON.stringify({
          action: rec.action,
          confidence: rec.confidence,
          approvalId,
          metrics: result.metrics,
        }),
      ]
    );

    await client.query(
      `INSERT INTO outbox (event_type, payload) VALUES ('investigation.completed', $1)`,
      [JSON.stringify({ exceptionId, investigationId, action: rec.action })]
    );

    await client.query('COMMIT');

    return {
      ...result,
      exceptionId,
      investigationId,
      nextStatus,
      approvalId,
    };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
