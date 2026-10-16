import { Queue, QueueOptions } from 'bullmq';
import IORedis, { Redis } from 'ioredis';

export const QUEUE_INVESTIGATIONS = 'investigations';
export const QUEUE_NOTIFICATIONS = 'notifications';

export const JOB_INVESTIGATE_EXCEPTION = 'investigate_exception';

export interface InvestigationJobData {
  jobId: number;
  exceptionId: number;
  investigationId?: number;
}

export function createRedisConnection(url?: string): Redis {
  return new IORedis(url || process.env.REDIS_URL || 'redis://localhost:6379', {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
  });
}

export function createQueue(
  name: string,
  connection: Redis,
  options: Partial<QueueOptions> = {}
): Queue {
  return new Queue(name, { connection, ...options });
}

export function getInvestigationsQueue(connection: Redis): Queue<InvestigationJobData> {
  return new Queue<InvestigationJobData>(QUEUE_INVESTIGATIONS, { connection });
}
