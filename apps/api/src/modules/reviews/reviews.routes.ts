import { Router } from 'express';

import { authenticate } from '../../middleware/authenticate.js';
import { requireEmailVerified } from '../../middleware/require-email-verified.js';

import { reviewsController } from './reviews.controller.js';

const reviewsRouter = Router();

reviewsRouter.post('/', authenticate, requireEmailVerified, reviewsController.create);
reviewsRouter.get('/', authenticate, requireEmailVerified, reviewsController.list);
reviewsRouter.post('/:reviewId/report', authenticate, requireEmailVerified, reviewsController.report);
reviewsRouter.post('/:reviewId/dispute', authenticate, requireEmailVerified, reviewsController.dispute);

export { reviewsRouter };
