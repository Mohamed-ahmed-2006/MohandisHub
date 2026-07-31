import { Router } from 'express';

import { authenticate } from '../../middleware/authenticate.js';
import { loadAdminFromDb } from '../../middleware/load-admin-from-db.js';
import { requireEmailVerified } from '../../middleware/require-email-verified.js';
import { requireAdminPermission, requireRole } from '../../middleware/require-role.js';
import { requireVerified } from '../../middleware/require-verified.js';

import { advertisementsController } from './advertisements.controller.js';

const advertisementsRouter = Router();

advertisementsRouter.get(
  '/active',
  authenticate,
  requireEmailVerified,
  advertisementsController.listActiveResolved,
);
advertisementsRouter.get(
  '/controls',
  authenticate,
  requireEmailVerified,
  advertisementsController.getAdControls,
);
advertisementsRouter.post(
  '/',
  authenticate,
  requireEmailVerified,
  requireRole('expert', 'business', 'craftsman'),
  requireVerified,
  advertisementsController.createAd,
);
advertisementsRouter.get(
  '/my',
  authenticate,
  requireEmailVerified,
  advertisementsController.listMyAds,
);
advertisementsRouter.post(
  '/:id/click',
  authenticate,
  requireEmailVerified,
  advertisementsController.trackClick,
);

// ---------------------------------------------------------------------------
// Advertiser billing actions
// ---------------------------------------------------------------------------
// Each one is ownership-checked in the service, inside the transaction that
// locks the campaign — not here, where a check would race the write.

advertisementsRouter.get(
  '/:id/billing',
  authenticate,
  requireEmailVerified,
  advertisementsController.getBillingState,
);
/** Buy one more seven-day week. */
advertisementsRouter.post(
  '/:id/renew',
  authenticate,
  requireEmailVerified,
  requireRole('expert', 'business', 'craftsman'),
  requireVerified,
  advertisementsController.renewAd,
);
/**
 * Retry the first week of an already-APPROVED campaign — e.g. after topping up
 * credits. Not a general "make this ad live" route: the service refuses anything
 * an admin has not approved, and anything whose start is not yet due.
 */
advertisementsRouter.post(
  '/:id/activate',
  authenticate,
  requireEmailVerified,
  requireRole('expert', 'business', 'craftsman'),
  requireVerified,
  advertisementsController.activateAd,
);
/**
 * Turn automatic weekly renewal on or off, or change its bounds.
 *
 * `requireVerified` alongside the role check, matching renew and activate:
 * enabling automatic renewal is a standing instruction to spend credits, and it
 * should not be reachable by an account that may not spend them today.
 */
advertisementsRouter.put(
  '/:id/auto-renewal',
  authenticate,
  requireEmailVerified,
  requireRole('expert', 'business', 'craftsman'),
  requireVerified,
  advertisementsController.setAutoRenewal,
);
/** The stored configuration and the consent record behind it. Owner or admin. */
advertisementsRouter.get(
  '/:id/auto-renewal',
  authenticate,
  requireEmailVerified,
  advertisementsController.getAutoRenewalState,
);
/** Explicit retry of a paused automatic renewal — the way out of "no credits". */
advertisementsRouter.post(
  '/:id/auto-renewal/retry',
  authenticate,
  requireEmailVerified,
  requireRole('expert', 'business', 'craftsman'),
  requireVerified,
  advertisementsController.retryAutoRenewal,
);
/** Every week this campaign has bought, paginated. Owner or admin. */
advertisementsRouter.get(
  '/:id/periods',
  authenticate,
  requireEmailVerified,
  advertisementsController.listPeriodHistory,
);

// ---------------------------------------------------------------------------
// Admin
// ---------------------------------------------------------------------------

advertisementsRouter.get(
  '/admin/all',
  authenticate,
  requireEmailVerified,
  loadAdminFromDb,
  requireRole('admin'),
  requireAdminPermission('manage_ads'),
  advertisementsController.listAllAds,
);
/** Moderation. `manage_ads`, re-loaded from the database on every request. */
advertisementsRouter.post(
  '/admin/:id/approve',
  authenticate,
  requireEmailVerified,
  loadAdminFromDb,
  requireRole('admin'),
  requireAdminPermission('manage_ads'),
  advertisementsController.adminApprove,
);
advertisementsRouter.post(
  '/admin/:id/reject',
  authenticate,
  requireEmailVerified,
  loadAdminFromDb,
  requireRole('admin'),
  requireAdminPermission('manage_ads'),
  advertisementsController.adminReject,
);
/**
 * Invoke the due-start activation service. Exists so the service is reachable
 * and testable while Wave 2F-B's scheduler does not exist yet.
 */
advertisementsRouter.post(
  '/admin/:id/activate-due',
  authenticate,
  requireEmailVerified,
  loadAdminFromDb,
  requireRole('admin'),
  requireAdminPermission('manage_ads'),
  advertisementsController.adminActivateDue,
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

advertisementsRouter.get(
  '/:id',
  authenticate,
  requireEmailVerified,
  advertisementsController.getAd,
);
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
