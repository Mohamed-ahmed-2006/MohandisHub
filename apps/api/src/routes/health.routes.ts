import type { HealthResponse } from '@mohandishub/shared';
import { Router } from 'express';

const healthRouter = Router();

healthRouter.get('/', (_req, res) => {
  const response: HealthResponse = { ok: true };
  res.status(200).json(response);
});

export { healthRouter };
