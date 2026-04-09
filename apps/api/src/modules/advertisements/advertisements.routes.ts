import { Router } from 'express';

import { authenticate } from '../../middleware/authenticate.js';
import { requireEmailVerified } from '../../middleware/require-email-verified.js';
import { requireAdminPermission, requireRole } from '../../middleware/require-role.js';
import { requireVerified } from '../../middleware/require-verified.js';

import { advertisementsController } from './advertisements.controller.js';

const advertisementsRouter = Router();

advertisementsRouter.get('/active', authenticate, requireEmailVerified, advertisementsController.listActiveResolved);
advertisementsRouter.get('/plans', authenticate, requireEmailVerified, advertisementsController.listPlans);
advertisementsRouter.post(
  '/',
  authenticate,
  requireEmailVerified,
  requireRole('expert', 'business', 'craftsman'),
  requireVerified,
  advertisementsController.createAd,
);
advertisementsRouter.post(
  '/:id/pay',
  authenticate,
  requireEmailVerified,
  requireRole('expert', 'business', 'craftsman'),
  requireVerified,
  advertisementsController.payAd,
);
advertisementsRouter.get('/my', authenticate, requireEmailVerified, advertisementsController.listMyAds);
advertisementsRouter.post('/:id/click', authenticate, requireEmailVerified, advertisementsController.trackClick);
advertisementsRouter.post(
  '/adcenter/resolve',
  authenticate,
  requireEmailVerified,
  advertisementsController.resolveAdCenter,
);

advertisementsRouter.get(
  '/admin/all',
  authenticate,
  requireEmailVerified,
  requireRole('admin'),
  requireAdminPermission('manage_ads'),
  advertisementsController.listAllAds,
);
advertisementsRouter.put(
  '/admin/:id/status',
  authenticate,
  requireEmailVerified,
  requireRole('admin'),
  requireAdminPermission('manage_ads'),
  advertisementsController.adminSetStatus,
);
advertisementsRouter.post(
  '/admin/:id/schedule',
  authenticate,
  requireEmailVerified,
  requireRole('admin'),
  requireAdminPermission('manage_ad_scheduling'),
  advertisementsController.adminSchedule,
);
advertisementsRouter.put(
  '/admin/:id/pricing',
  authenticate,
  requireEmailVerified,
  requireRole('admin'),
  requireAdminPermission('manage_ad_pricing'),
  advertisementsController.adminPricingOverride,
);
advertisementsRouter.get(
  '/admin/pricing-rules',
  authenticate,
  requireEmailVerified,
  requireRole('admin'),
  requireAdminPermission('manage_ad_pricing'),
  advertisementsController.listPricingRules,
);
advertisementsRouter.post(
  '/admin/pricing-rules',
  authenticate,
  requireEmailVerified,
  requireRole('admin'),
  requireAdminPermission('manage_ad_pricing'),
  advertisementsController.createPricingRule,
);
advertisementsRouter.put(
  '/admin/pricing-rules/:id',
  authenticate,
  requireEmailVerified,
  requireRole('admin'),
  requireAdminPermission('manage_ad_pricing'),
  advertisementsController.updatePricingRule,
);
advertisementsRouter.delete(
  '/admin/pricing-rules/:id',
  authenticate,
  requireEmailVerified,
  requireRole('admin'),
  requireAdminPermission('manage_ad_pricing'),
  advertisementsController.disablePricingRule,
);

advertisementsRouter.get('/:id', authenticate, requireEmailVerified, advertisementsController.getAd);
advertisementsRouter.put(
  '/:id',
  authenticate,
  requireEmailVerified,
  requireRole('expert', 'business', 'craftsman'),
  advertisementsController.updateAd,
);
advertisementsRouter.delete(
  '/:id',
  authenticate,
  requireEmailVerified,
  requireRole('expert', 'business', 'craftsman'),
  advertisementsController.deleteAd,
);

export { advertisementsRouter };

