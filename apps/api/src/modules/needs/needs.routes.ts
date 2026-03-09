import { Router } from 'express';

import { authenticate } from '../../middleware/authenticate.js';
import { requireEmailVerified } from '../../middleware/require-email-verified.js';
import { requireVerified } from '../../middleware/require-verified.js';

import { needsController } from './needs.controller.js';

const needsRouter = Router();

needsRouter.post('/', authenticate, requireEmailVerified, needsController.createNeed);
needsRouter.get('/my', authenticate, requireEmailVerified, needsController.listMyNeeds);
needsRouter.get('/', authenticate, requireEmailVerified, needsController.listOpenNeeds);
needsRouter.get('/:id', authenticate, requireEmailVerified, needsController.getNeed);
needsRouter.patch('/:id', authenticate, requireEmailVerified, needsController.updateNeed);
needsRouter.post('/:id/award', authenticate, requireEmailVerified, needsController.awardBid);
needsRouter.post('/:id/bids/:bidId/pay', authenticate, requireEmailVerified, needsController.payBid);

needsRouter.post(
  '/:needId/bids',
  authenticate,
  requireEmailVerified,
  requireVerified,
  needsController.createBid,
);
needsRouter.get(
  '/:needId/bids',
  authenticate,
  requireEmailVerified,
  needsController.listBidsForNeed,
);

needsRouter.patch(
  '/:needId/bids/:bidId',
  authenticate,
  requireEmailVerified,
  requireVerified,
  needsController.updateBid,
);

needsRouter.delete(
  '/:needId/bids/:bidId',
  authenticate,
  requireEmailVerified,
  needsController.deleteBid,
);

needsRouter.get(
  '/:needId/bids/:bidId/messages',
  authenticate,
  requireEmailVerified,
  needsController.listBidMessages,
);
needsRouter.post(
  '/:needId/bids/:bidId/messages',
  authenticate,
  requireEmailVerified,
  needsController.createBidMessage,
);

const bidsRouter = Router();
bidsRouter.get('/my', authenticate, requireEmailVerified, needsController.listMyBids);

export { needsRouter, bidsRouter };
