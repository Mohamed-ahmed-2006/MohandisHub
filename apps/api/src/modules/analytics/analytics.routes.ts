// ---------------------------------------------------------------------------
// Analytics routes — provider analytics (authenticated, expert/business)
// ---------------------------------------------------------------------------

import { Router } from 'express';

import { authenticate } from '../../middleware/authenticate.js';
import { requireEmailVerified } from '../../middleware/require-email-verified.js';
import { requireRole } from '../../middleware/require-role.js';

import { analyticsController } from './analytics.controller.js';

const analyticsRouter = Router();

analyticsRouter.use(authenticate, requireEmailVerified);

analyticsRouter.get(
  '/me',
  requireRole('expert', 'business', 'craftsman'),
  analyticsController.getMyAnalytics,
);

export { analyticsRouter };
