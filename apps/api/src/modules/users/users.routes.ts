import { Router } from 'express';

import { authenticate } from '../../middleware/authenticate.js';
import { requireEmailVerified } from '../../middleware/require-email-verified.js';

import { usersController } from './users.controller.js';

const usersRouter = Router();

usersRouter.patch('/me', authenticate, requireEmailVerified, usersController.updateMe);
usersRouter.post(
  '/me/request-email-change',
  authenticate,
  requireEmailVerified,
  usersController.requestEmailChange,
);
usersRouter.post(
  '/me/confirm-email-change',
  authenticate,
  requireEmailVerified,
  usersController.confirmEmailChange,
);

usersRouter.get('/me/activity', authenticate, requireEmailVerified, usersController.getMyActivity);

export { usersRouter };
