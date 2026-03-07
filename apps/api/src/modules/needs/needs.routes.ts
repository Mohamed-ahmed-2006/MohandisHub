import { Router } from 'express';

import { authenticate } from '../../middleware/authenticate.js';
import { requireEmailVerified } from '../../middleware/require-email-verified.js';

import { needsController } from './needs.controller.js';

const needsRouter = Router();

needsRouter.post('/', authenticate, requireEmailVerified, needsController.createNeed);
needsRouter.get('/my', authenticate, requireEmailVerified, needsController.listMyNeeds);
needsRouter.get('/', authenticate, requireEmailVerified, needsController.listOpenNeeds);
needsRouter.get('/:id', authenticate, requireEmailVerified, needsController.getNeed);
needsRouter.patch('/:id', authenticate, requireEmailVerified, needsController.updateNeed);
needsRouter.post('/:id/award', authenticate, requireEmailVerified, needsController.awardBid);

needsRouter.post('/:needId/bids', authenticate, requireEmailVerified, needsController.createBid);
needsRouter.get(
  '/:needId/bids',
  authenticate,
  requireEmailVerified,
  needsController.listBidsForNeed,
);

const bidsRouter = Router();
bidsRouter.get('/my', authenticate, requireEmailVerified, needsController.listMyBids);

export { needsRouter, bidsRouter };
