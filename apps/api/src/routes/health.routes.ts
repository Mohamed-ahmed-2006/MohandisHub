import type { HealthResponse } from '@mohandishub/shared';
import { Router } from 'express';

import { pingDb } from '../db/health.js';
import { hasDatabaseConfig } from '../db/pool.js';

const healthRouter = Router();

healthRouter.get('/', async (_req, res) => {
  const response: HealthResponse = {
    ok: true,
    ...(hasDatabaseConfig() ? { database: await pingDb() } : {}),
  };
  res.status(200).json(response);
});

export { healthRouter };
