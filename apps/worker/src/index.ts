import './env';
import { createRedisConnection } from '@cashflow/queue';
import { logger } from './logger';
import { createInvestigationWorker } from './investigationWorker';
import { startOutboxPublisher } from './outboxPublisher';

const connection = createRedisConnection();

const worker = createInvestigationWorker(createRedisConnection());
const stopOutbox = startOutboxPublisher(connection);

logger.info('Worker started (investigations + outbox publisher)');

async function shutdown(signal: string): Promise<void> {
  logger.info({ signal }, 'Shutting down worker');
  try {
    await worker.close();
    await stopOutbox();
    await connection.quit();
  } catch (err) {
    logger.error({ err }, 'Error during shutdown');
  } finally {
    process.exit(0);
  }
}

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
