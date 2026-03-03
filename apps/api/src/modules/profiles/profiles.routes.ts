// ---------------------------------------------------------------------------
// Profiles routes — user profile + document submission
// Admin routes — verification review panel
// ---------------------------------------------------------------------------

import { Router } from 'express';

import { authenticate } from '../../middleware/authenticate.js';

import { profilesController } from './profiles.controller.js';

// ── User-facing profile routes (/api/profiles) ──────────────────────────

const profilesRouter = Router();

// Expert profile
profilesRouter.get('/expert', authenticate, profilesController.getExpertProfile);
profilesRouter.patch('/expert', authenticate, profilesController.updateExpertProfile);

// Business profile
profilesRouter.get('/business', authenticate, profilesController.getBusinessProfile);
profilesRouter.patch('/business', authenticate, profilesController.updateBusinessProfile);

// Identity documents (expert + business)
profilesRouter.post('/identity-documents', authenticate, profilesController.submitIdentityDocument);
profilesRouter.get('/identity-documents', authenticate, profilesController.getIdentityDocuments);

// Academic records (expert only)
profilesRouter.post('/academic-records', authenticate, profilesController.submitAcademicRecord);
profilesRouter.get('/academic-records', authenticate, profilesController.getAcademicRecords);

// ── Admin routes (/api/admin) ────────────────────────────────────────────

const adminRouter = Router();

// All admin routes require authentication (admin role enforced in controller)
adminRouter.use(authenticate);

// Pending verifications dashboard
adminRouter.get('/verification/pending', profilesController.getPendingVerifications);

// Review identity document
adminRouter.post('/identity/:docId/review', profilesController.reviewIdentityDocument);

// Review academic record
adminRouter.post('/academic/:recordId/review', profilesController.reviewAcademicRecord);

// Review business documents (commercial register, trade license, etc.)
adminRouter.post('/business/:userId/review', profilesController.reviewBusinessDocs);

// View any user's full profile (for admin review context)
adminRouter.get('/user/:userId/profile', profilesController.getAnyUserProfile);

export { adminRouter, profilesRouter };
