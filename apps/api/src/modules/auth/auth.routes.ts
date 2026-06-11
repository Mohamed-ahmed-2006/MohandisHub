// ---------------------------------------------------------------------------
// Auth routes
// ---------------------------------------------------------------------------

import { Router } from 'express';

import { authenticate } from '../../middleware/authenticate.js';
import {
  loginRateLimiter,
  passwordResetRateLimiter,
  registerRateLimiter,
} from '../../middleware/rate-limit.js';
import { requireTrustedAuthOrigin } from '../../middleware/require-trusted-auth-origin.js';

import { authController } from './auth.controller.js';

const authRouter = Router();

// Public routes (sensitive endpoints get stricter per-endpoint limits)
authRouter.post('/register', registerRateLimiter, authController.register);
authRouter.post('/login', loginRateLimiter, authController.login);
authRouter.post('/forgot-password', passwordResetRateLimiter, authController.forgotPassword);
authRouter.post('/reset-password', passwordResetRateLimiter, authController.resetPassword);
authRouter.post('/refresh', requireTrustedAuthOrigin, authController.refresh);
authRouter.post('/logout', requireTrustedAuthOrigin, authController.logout);

// Protected routes
authRouter.get('/me', authenticate, authController.me);

export { authRouter };
