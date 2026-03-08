import { Router } from 'express';

import { authenticate } from '../../middleware/authenticate.js';
import { requireEmailVerified } from '../../middleware/require-email-verified.js';

import { bookingsController } from './bookings.controller.js';

const bookingsRouter = Router();

bookingsRouter.post('/', authenticate, requireEmailVerified, bookingsController.create);
bookingsRouter.get('/my', authenticate, requireEmailVerified, bookingsController.listMy);
bookingsRouter.get('/:id', authenticate, requireEmailVerified, bookingsController.getById);
bookingsRouter.patch('/:id', authenticate, requireEmailVerified, bookingsController.update);

export { bookingsRouter };
