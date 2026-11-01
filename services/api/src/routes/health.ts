import { Router } from 'express';
import { getDatabaseStatus } from '../config/database.js';

export const healthRouter = Router();

healthRouter.get('/health', (_req, res) => {
  const database = getDatabaseStatus();
  const isReady = database === 'connected';

  res.status(isReady ? 200 : 503).json({
    data: {
      status: isReady ? 'ok' : 'degraded',
      service: 'famshield-api',
      database,
      timestamp: new Date().toISOString(),
    },
  });
});
