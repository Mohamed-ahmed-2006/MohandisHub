// ---------------------------------------------------------------------------
// OTP routes — all routes require authentication
// ---------------------------------------------------------------------------

import { Router } from 'express';

import { authenticate } from '../../middleware/authenticate.js';

import { otpController } from './otp.controller.js';

const otpRouter = Router();

otpRouter.post('/send', authenticate, otpController.send);
otpRouter.post('/verify', authenticate, otpController.verify);

export { otpRouter };
