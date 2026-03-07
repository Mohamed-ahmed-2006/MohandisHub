import { Router } from 'express';

import { authenticate } from '../../middleware/authenticate.js';
import { requireEmailVerified } from '../../middleware/require-email-verified.js';

import { plansController } from './plans.controller.js';

const plansRouter = Router();

plansRouter.get('/', plansController.listActivePlans);
plansRouter.post(
  '/:planId/subscribe',
  authenticate,
  requireEmailVerified,
  plansController.subscribe,
);

export { plansRouter };
