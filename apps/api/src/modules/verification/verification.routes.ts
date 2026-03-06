// ---------------------------------------------------------------------------
// Verification routes
// ---------------------------------------------------------------------------

import { Router } from 'express';

import { authenticate } from '../../middleware/authenticate.js';
import { requireEmailVerified } from '../../middleware/require-email-verified.js';

import { verificationController } from './verification.controller.js';

const verificationRouter = Router();

// Protected routes (user must be logged in and email verified)
verificationRouter.post(
  '/initiate',
  authenticate,
  requireEmailVerified,
  verificationController.initiate,
);
verificationRouter.get(
  '/status',
  authenticate,
  requireEmailVerified,
  verificationController.getStatus,
);

// Public route (called by external provider)
verificationRouter.post('/webhook', verificationController.webhook);

export { verificationRouter };
