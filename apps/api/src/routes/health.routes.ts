import type { HealthResponse } from '@mohandishub/shared';
import { Router } from 'express';

import { pingDb } from '../db/health.js';
import { hasDatabaseConfig } from '../db/pool.js';
import { asyncHandler } from '../utils/async-handler.js';

const healthRouter = Router();

healthRouter.get(
  '/',
  asyncHandler(async (_req, res) => {
    const response: HealthResponse = {
      ok: true,
      ...(hasDatabaseConfig() ? { database: await pingDb() } : {}),
    };
    res.status(200).json(response);
  }),
);

/** Readiness: 200 if DB is reachable, 503 otherwise. Use for Render health check path. */
healthRouter.get(
  '/ready',
  asyncHandler(async (_req, res) => {
    if (!hasDatabaseConfig()) {
      res.status(200).json({ ok: true, ready: true });
      return;
    }
    const dbOk = await pingDb();
    if (!dbOk) {
      res.status(503).json({ ok: false, ready: false, database: false });
      return;
    }
    res.status(200).json({ ok: true, ready: true, database: true });
  }),
);

export { healthRouter };
