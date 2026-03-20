// ---------------------------------------------------------------------------
// Profiles routes — user profile + document submission
// ---------------------------------------------------------------------------

import { Router } from 'express';

import { authenticate } from '../../middleware/authenticate.js';
import { requireEmailVerified } from '../../middleware/require-email-verified.js';

import { profilesController } from './profiles.controller.js';

// ── User-facing profile routes (/api/profiles) ──────────────────────────

const profilesRouter = Router();

// Public — top providers and public profile (must be before /expert, /business)
profilesRouter.get('/top-experts', profilesController.getTopExperts);
profilesRouter.get('/top-businesses', profilesController.getTopBusinesses);
profilesRouter.get('/top-craftsmen', profilesController.getTopCraftsmen);
profilesRouter.get('/public/:userId', profilesController.getPublicProfile);

// Expert profile
profilesRouter.get(
  '/expert',
  authenticate,
  requireEmailVerified,
  profilesController.getExpertProfile,
);
profilesRouter.patch(
  '/expert',
  authenticate,
  requireEmailVerified,
  profilesController.updateExpertProfile,
);

// Craftsman profile
profilesRouter.get(
  '/craftsman',
  authenticate,
  requireEmailVerified,
  profilesController.getCraftsmanProfile,
);
profilesRouter.patch(
  '/craftsman',
  authenticate,
  requireEmailVerified,
  profilesController.updateCraftsmanProfile,
);
profilesRouter.post(
  '/craftsman/complete-onboarding',
  authenticate,
  requireEmailVerified,
  profilesController.completeCraftsmanOnboarding,
);

// Customer profile
profilesRouter.get(
  '/customer',
  authenticate,
  requireEmailVerified,
  profilesController.getCustomerProfile,
);
profilesRouter.patch(
  '/customer',
  authenticate,
  requireEmailVerified,
  profilesController.updateCustomerProfile,
);

// Business profile
profilesRouter.get(
  '/business',
  authenticate,
  requireEmailVerified,
  profilesController.getBusinessProfile,
);
profilesRouter.patch(
  '/business',
  authenticate,
  requireEmailVerified,
  profilesController.updateBusinessProfile,
);
profilesRouter.post(
  '/business/complete-onboarding',
  authenticate,
  requireEmailVerified,
  profilesController.completeBusinessOnboarding,
);

// Identity documents (expert + business) — no requireVerified so unverified users can submit for KYC
profilesRouter.post(
  '/identity-documents',
  authenticate,
  requireEmailVerified,
  profilesController.submitIdentityDocument,
);
profilesRouter.get(
  '/identity-documents',
  authenticate,
  requireEmailVerified,
  profilesController.getIdentityDocuments,
);

// Academic records (expert only) — no requireVerified so onboarding users can submit
profilesRouter.post(
  '/academic-records',
  authenticate,
  requireEmailVerified,
  profilesController.submitAcademicRecord,
);
profilesRouter.get(
  '/academic-records',
  authenticate,
  requireEmailVerified,
  profilesController.getAcademicRecords,
);
profilesRouter.patch(
  '/academic-records/:recordId',
  authenticate,
  requireEmailVerified,
  profilesController.updateAcademicRecord,
);

export { profilesRouter };
