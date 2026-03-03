// ---------------------------------------------------------------------------
// Verification routes
// ---------------------------------------------------------------------------

import { Router } from 'express';

import { authenticate } from '../../middleware/authenticate.js';

import { verificationController } from './verification.controller.js';

const verificationRouter = Router();

// Protected routes (user must be logged in)
verificationRouter.post('/initiate', authenticate, verificationController.initiate);
verificationRouter.get('/status', authenticate, verificationController.getStatus);

// Public route (called by external provider)
verificationRouter.post('/webhook', verificationController.webhook);

export { verificationRouter };
