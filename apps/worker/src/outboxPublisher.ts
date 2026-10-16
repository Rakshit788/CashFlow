import { getClient } from '@cashflow/db';
import { Queue } from 'bullmq';
import {
  InvestigationJobData,
  JOB_INVESTIGATE_EXCEPTION,
  QUEUE_INVESTIGATIONS,
  createQueue,
} from '@cashflow/queue';
import type { Redis } from 'ioredis';
import { logger } from './logger';

interface OutboxRow {
  id: number;
  event_type: string;
  payload: any;
}

async function enqueueEvent(
  row: OutboxRow,
  investigationsQueue: Queue<InvestigationJobData>,
  notificationsQueue: Queue
): Promise<void> {
  switch (row.event_type) {
    case 'investigation.requested': {
      const { jobId, exceptionId, investigationId } = row.payload;
      const maxAttempts = parseInt(process.env.MAX_JOB_ATTEMPTS || '5', 10);
      await investigationsQueue.add(
        JOB_INVESTIGATE_EXCEPTION,
        { jobId, exceptionId, investigationId },
        {
          jobId: `db-${jobId}`,
          attempts: maxAttempts,
          backoff: { type: 'exponential', delay: 2000 },
          removeOnComplete: 100,
          removeOnFail: 500,
        }
      );
      logger.info({ jobId, exceptionId }, 'Enqueued investigation job');
      break;
    }
    case 'approval.requested': {
      await notificationsQueue.add('approval.requested', row.payload, {
        removeOnComplete: 100,
        removeOnFail: 500,
      });
      break;
    }
    case 'investigation.completed': {
      await notificationsQueue.add('investigation.completed', row.payload, {
        removeOnComplete: 100,
        removeOnFail: 500,
      });
      break;
    }
    default:
      logger.debug({ event: row.event_type }, 'No handler for outbox event; marked published');
  }
}

export function startOutboxPublisher(connection: Redis): () => Promise<void> {
  const investigationsQueue = createQueue(QUEUE_INVESTIGATIONS, connection) as Queue<InvestigationJobData>;
  const notificationsQueue = createQueue('notifications', connection);
  const intervalMs = parseInt(process.env.OUTBOX_POLL_INTERVAL_MS || '1000', 10);
  let running = false;
  let stopped = false;

  async function poll(): Promise<void> {
    if (running || stopped) return;
    running = true;
    const client = await getClient();
    try {
      await client.query('BEGIN');
      const res = await client.query<OutboxRow>(
        `SELECT id, event_type, payload FROM outbox
         WHERE published = false
         ORDER BY id
         LIMIT 50
         FOR UPDATE SKIP LOCKED`
      );

      for (const row of res.rows) {
        await enqueueEvent(row, investigationsQueue, notificationsQueue);
        await client.query(
          `UPDATE outbox SET published = true, published_at = NOW() WHERE id = $1`,
          [row.id]
        );
      }
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined);
      logger.error({ err }, 'Outbox publish cycle failed; will retry');
    } finally {
      client.release();
      running = false;
    }
  }

  const timer = setInterval(() => {
    poll().catch((err) => logger.error({ err }, 'Outbox poll error'));
  }, intervalMs);

  logger.info({ intervalMs }, 'Outbox publisher started');

  return async () => {
    stopped = true;
    clearInterval(timer);
    await Promise.allSettled([investigationsQueue.close(), notificationsQueue.close()]);
  };
}
