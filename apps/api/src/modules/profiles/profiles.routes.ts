// ---------------------------------------------------------------------------
// Profiles routes — user profile + document submission
// ---------------------------------------------------------------------------

import { Router } from 'express';

import { authenticate } from '../../middleware/authenticate.js';
import { requireEmailVerified } from '../../middleware/require-email-verified.js';

import { profilesController } from './profiles.controller.js';

// ── User-facing profile routes (/api/profiles) ──────────────────────────

const profilesRouter = Router();

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

export { profilesRouter };
