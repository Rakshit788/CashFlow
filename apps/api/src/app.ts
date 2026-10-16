import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { exceptionsRouter } from './routes/exceptions';
import { jobsRouter } from './routes/jobs';
import { approvalsRouter } from './routes/approvals';
import { auditRouter } from './routes/audit';
import { investigationsRouter } from './routes/investigations';
import { errorHandler } from './middleware/error';
import { attachUser } from './middleware/rbac';
import { idempotency } from './middleware/idempotency';

export function createApp() {
  const app = express();

  app.use(helmet());
  app.use(cors());
  app.use(express.json({ limit: '1mb' }));
  app.use(attachUser);
  app.use(idempotency);

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
  });

  app.use('/api/exceptions', exceptionsRouter);
  app.use('/api/jobs', jobsRouter);
  app.use('/api/approvals', approvalsRouter);
  app.use('/api/audit-logs', auditRouter);
  app.use('/api/investigations', investigationsRouter);

  app.use(errorHandler);

  return app;
}
