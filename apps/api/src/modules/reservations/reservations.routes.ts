import { Router } from 'express';

import { authenticate } from '../../middleware/authenticate.js';
import { requireEmailVerified } from '../../middleware/require-email-verified.js';
import { requireRole } from '../../middleware/require-role.js';
import { requireVerified } from '../../middleware/require-verified.js';

import { reservationsController } from './reservations.controller.js';

const reservationsRouter = Router();

reservationsRouter.use(authenticate, requireEmailVerified);

reservationsRouter.get('/profile/me', requireRole('expert', 'business'), reservationsController.getMyProfile);
reservationsRouter.patch(
  '/profile/me',
  requireRole('expert', 'business'),
  requireVerified,
  reservationsController.upsertMyProfile,
);
reservationsRouter.get('/profile/:providerId', reservationsController.getProviderProfile);

reservationsRouter.get('/slots', reservationsController.listSlots);
reservationsRouter.post(
  '/slots',
  requireRole('expert', 'business'),
  requireVerified,
  reservationsController.createSlot,
);
reservationsRouter.patch(
  '/slots/:slotId',
  requireRole('expert', 'business'),
  requireVerified,
  reservationsController.updateSlot,
);
reservationsRouter.delete(
  '/slots/:slotId',
  requireRole('expert', 'business'),
  requireVerified,
  reservationsController.deleteSlot,
);

reservationsRouter.post('/', requireRole('customer'), reservationsController.createReservation);
reservationsRouter.get('/my', reservationsController.listMyReservations);
reservationsRouter.get('/disputes', requireRole('admin'), reservationsController.listDisputes);
reservationsRouter.get(
  '/admin/action-failures',
  requireRole('admin'),
  reservationsController.listActionFailures,
);
reservationsRouter.post(
  '/admin/action-failures/:failureId/replay',
  requireRole('admin'),
  reservationsController.replayActionFailure,
);
reservationsRouter.post(
  '/admin/:reservationId/reconcile',
  requireRole('admin'),
  reservationsController.reconcileReservation,
);
reservationsRouter.post(
  '/disputes/:disputeId/resolve',
  requireRole('admin'),
  reservationsController.resolveDispute,
);

reservationsRouter.get('/:reservationId', reservationsController.getReservationById);
reservationsRouter.get('/:reservationId/timeline', reservationsController.listReservationTimeline);
reservationsRouter.post(
  '/:reservationId/decision',
  requireRole('expert', 'business'),
  reservationsController.decideReservation,
);
reservationsRouter.post('/:reservationId/cancel', reservationsController.cancelReservation);

reservationsRouter.get('/:reservationId/location', reservationsController.listLocationProposals);
reservationsRouter.post('/:reservationId/location/propose', reservationsController.proposeLocation);
reservationsRouter.post('/:reservationId/location/respond', reservationsController.respondLocation);

reservationsRouter.get(
  '/:reservationId/offline/checkin-codes',
  reservationsController.getOfflineCheckinCodes,
);
reservationsRouter.post('/:reservationId/offline/checkin', reservationsController.confirmOfflineCheckin);
reservationsRouter.post('/:reservationId/finish', reservationsController.finishReservation);

reservationsRouter.post('/:reservationId/call/join', reservationsController.joinCall);
reservationsRouter.post('/:reservationId/call/heartbeat', reservationsController.callHeartbeat);
reservationsRouter.post('/:reservationId/call/extension', reservationsController.decideCallExtension);
reservationsRouter.post('/:reservationId/call/end', reservationsController.endCall);
reservationsRouter.post('/:reservationId/call/renew-token', reservationsController.renewCallToken);
reservationsRouter.get('/:reservationId/call/snapshot', reservationsController.getCallSnapshot);

export { reservationsRouter };
