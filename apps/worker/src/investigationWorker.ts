import { Worker, Job } from 'bullmq';
import { query } from '@cashflow/db';
import { runInvestigation } from '@cashflow/agent';
import type { AgentCache } from '@cashflow/agent';
import {
  QUEUE_INVESTIGATIONS,
  JOB_INVESTIGATE_EXCEPTION,
  InvestigationJobData,
} from '@cashflow/queue';
import type { Redis } from 'ioredis';
import { logger } from './logger';

async function processInvestigation(job: Job<InvestigationJobData>, redis: Redis): Promise<void> {
  const { jobId, exceptionId } = job.data;

  const rows = await query<{ status: string }>('SELECT status FROM jobs WHERE id = $1', [jobId]);
  if (rows.length === 0) {
    logger.warn({ jobId }, 'DB job row not found; skipping');
    return;
  }
  if (rows[0].status === 'completed') {
    logger.info({ jobId }, 'DB job already completed; skipping (idempotent)');
    return;
  }

  const attempt = job.attemptsMade + 1;
  logger.info({ jobId, exceptionId, attempt }, 'Starting investigation');

  await query(
    `UPDATE jobs
     SET status = 'active', started_at = COALESCE(started_at, NOW()), attempts = attempts + 1
     WHERE id = $1`,
    [jobId]
  );
  await query(
    `UPDATE investigations SET status = 'running' WHERE job_id = $1 AND status <> 'completed'`,
    [jobId]
  );

  const cache: AgentCache = {
    get: (key) => redis.get(key),
    set: (key, value, ttlSeconds) => redis.set(key, value, 'EX', ttlSeconds),
  };
  const outcome = await runInvestigation(exceptionId, jobId, { cache });

  await query(
    `UPDATE jobs SET status = 'completed', finished_at = NOW(), error = NULL WHERE id = $1`,
    [jobId]
  );

  logger.info(
    {
      jobId,
      exceptionId,
      action: outcome.recommendation.action,
      confidence: outcome.recommendation.confidence,
      provider: outcome.provider,
      nextStatus: outcome.nextStatus,
      metrics: outcome.metrics,
    },
    'Investigation completed'
  );
}

export function createInvestigationWorker(connection: Redis): Worker<InvestigationJobData> {
  const worker = new Worker<InvestigationJobData>(
    QUEUE_INVESTIGATIONS,
    async (job) => {
      if (job.name !== JOB_INVESTIGATE_EXCEPTION) {
        logger.warn({ name: job.name }, 'Unknown job name; ignoring');
        return;
      }
      await processInvestigation(job, connection);
    },
    {
      connection,
      concurrency: parseInt(process.env.WORKER_CONCURRENCY || '2', 10),
    }
  );

  worker.on('completed', (job) => {
    logger.debug({ jobId: job.id }, 'BullMQ job completed');
  });

  worker.on('failed', async (job, err) => {
    if (!job) return;
    logger.error({ jobId: job.id, err: err.message }, 'BullMQ job failed');

    const attempts = job.opts.attempts ?? 1;
    if (job.attemptsMade >= attempts) {
      const { jobId, exceptionId } = job.data;
      try {
        await query(
          `UPDATE jobs SET status = 'failed', finished_at = NOW(), error = $1 WHERE id = $2`,
          [err.message, jobId]
        );
        await query(
          `UPDATE investigations SET status = 'failed' WHERE job_id = $1`,
          [jobId]
        );
        await query(`UPDATE exceptions SET status = 'open' WHERE id = $1 AND status = 'investigating'`, [
          exceptionId,
        ]);
      } catch (dbErr) {
        logger.error({ dbErr }, 'Failed to record terminal job failure');
      }
    }
  });

  return worker;
}
