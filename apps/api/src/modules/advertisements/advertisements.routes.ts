import { Router } from 'express';

import { authenticate } from '../../middleware/authenticate.js';
import { loadAdminFromDb } from '../../middleware/load-admin-from-db.js';
import { requireEmailVerified } from '../../middleware/require-email-verified.js';
import { requireAdminPermission, requireRole } from '../../middleware/require-role.js';
import { requireVerified } from '../../middleware/require-verified.js';

import { advertisementsController } from './advertisements.controller.js';

const advertisementsRouter = Router();

advertisementsRouter.get('/active', authenticate, requireEmailVerified, advertisementsController.listActiveResolved);
advertisementsRouter.get('/controls', authenticate, requireEmailVerified, advertisementsController.getAdControls);
advertisementsRouter.post(
  '/',
  authenticate,
  requireEmailVerified,
  requireRole('expert', 'business', 'craftsman'),
  requireVerified,
  advertisementsController.createAd,
);
advertisementsRouter.get('/my', authenticate, requireEmailVerified, advertisementsController.listMyAds);
advertisementsRouter.post('/:id/click', authenticate, requireEmailVerified, advertisementsController.trackClick);

advertisementsRouter.get(
  '/admin/all',
  authenticate,
  requireEmailVerified,
  loadAdminFromDb,
  requireRole('admin'),
  requireAdminPermission('manage_ads'),
  advertisementsController.listAllAds,
);
advertisementsRouter.put(
  '/admin/:id/status',
  authenticate,
  requireEmailVerified,
  loadAdminFromDb,
  requireRole('admin'),
  requireAdminPermission('manage_ads'),
  advertisementsController.adminSetStatus,
);
advertisementsRouter.post(
  '/admin/:id/schedule',
  authenticate,
  requireEmailVerified,
  loadAdminFromDb,
  requireRole('admin'),
  requireAdminPermission('manage_ad_scheduling'),
  advertisementsController.adminSchedule,
);
advertisementsRouter.put(
  '/admin/:id/pricing',
  authenticate,
  requireEmailVerified,
  loadAdminFromDb,
  requireRole('admin'),
  requireAdminPermission('manage_ad_pricing'),
  advertisementsController.adminPricingOverride,
);
advertisementsRouter.get(
  '/admin/controls',
  authenticate,
  requireEmailVerified,
  loadAdminFromDb,
  requireRole('admin'),
  requireAdminPermission('manage_ad_pricing'),
  advertisementsController.getAdControls,
);
advertisementsRouter.put(
  '/admin/controls',
  authenticate,
  requireEmailVerified,
  loadAdminFromDb,
  requireRole('admin'),
  requireAdminPermission('manage_ad_pricing'),
  advertisementsController.updateAdminAdControls,
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
