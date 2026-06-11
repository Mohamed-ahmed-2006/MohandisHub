import { Router } from 'express';

import { authenticate } from '../../middleware/authenticate.js';
import { requireEmailVerified } from '../../middleware/require-email-verified.js';

import { plansController } from './plans.controller.js';

const plansRouter = Router();

plansRouter.get('/', authenticate, plansController.listActivePlans);
plansRouter.get('/usage', authenticate, plansController.getMyUsage);
plansRouter.get('/my-subscription', authenticate, plansController.getCurrentSubscription);
plansRouter.post(
  '/:planId/subscribe',
  authenticate,
  requireEmailVerified,
  plansController.subscribe,
);

export { plansRouter };
