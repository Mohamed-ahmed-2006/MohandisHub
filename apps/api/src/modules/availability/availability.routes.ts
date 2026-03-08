import { Router } from 'express';

import { authenticate } from '../../middleware/authenticate.js';
import { requireEmailVerified } from '../../middleware/require-email-verified.js';

import { availabilityController } from './availability.controller.js';

const availabilityRouter = Router();

availabilityRouter.get('/slots', authenticate, requireEmailVerified, availabilityController.list);
availabilityRouter.post('/slots', authenticate, requireEmailVerified, availabilityController.create);
availabilityRouter.post(
  '/slots/bulk',
  authenticate,
  requireEmailVerified,
  availabilityController.createMany,
);
availabilityRouter.patch(
  '/slots/:id',
  authenticate,
  requireEmailVerified,
  availabilityController.update,
);
availabilityRouter.delete(
  '/slots/:id',
  authenticate,
  requireEmailVerified,
  availabilityController.remove,
);

export { availabilityRouter };
