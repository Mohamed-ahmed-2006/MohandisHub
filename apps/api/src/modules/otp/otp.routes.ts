// ---------------------------------------------------------------------------
// OTP routes — all routes require authentication
// ---------------------------------------------------------------------------

import { Router } from 'express';

import { authenticate } from '../../middleware/authenticate.js';
import { otpRateLimiter } from '../../middleware/rate-limit.js';

import { otpController } from './otp.controller.js';

const otpRouter = Router();

otpRouter.post('/send', otpRateLimiter, authenticate, otpController.send);
otpRouter.post('/verify', otpRateLimiter, authenticate, otpController.verify);

export { otpRouter };
