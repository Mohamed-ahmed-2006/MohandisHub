// ---------------------------------------------------------------------------
// Help & Resolution routes
// ---------------------------------------------------------------------------
// The user surface carries no admin elevation at all. `req.user.isAdmin` on
// these routes comes from a JWT that may be hours old, so nothing here reads
// it: an admin acting as an admin uses /admin/*, which re-reads the flag and
// the permission set from the database on every request.
// ---------------------------------------------------------------------------

import { Router } from 'express';

import { authenticate } from '../../middleware/authenticate.js';
import { loadAdminFromDb } from '../../middleware/load-admin-from-db.js';
import { requireEmailVerified } from '../../middleware/require-email-verified.js';
import { requireAdminAnyPermission, requireRole } from '../../middleware/require-role.js';

import { helpResolutionController } from './help-resolution.controller.js';

const helpResolutionRouter = Router();

helpResolutionRouter.use(authenticate, requireEmailVerified);

// Admin queue. Declared before `/cases/:caseId` so `/admin` is never read as a
// case id.
const adminOnly = [
  loadAdminFromDb,
  requireRole('admin'),
  requireAdminAnyPermission('manage_support', 'manage_transactions'),
] as const;

helpResolutionRouter.get('/admin/cases', ...adminOnly, helpResolutionController.listAdminCases);
helpResolutionRouter.get(
  '/admin/cases/:caseId',
  ...adminOnly,
  helpResolutionController.getAdminCase,
);
helpResolutionRouter.post(
  '/admin/cases/:caseId/messages',
  ...adminOnly,
  helpResolutionController.postAdminMessage,
);
helpResolutionRouter.post(
  '/admin/cases/:caseId/assign',
  ...adminOnly,
  helpResolutionController.assignCase,
);
helpResolutionRouter.post(
  '/admin/cases/:caseId/status',
  ...adminOnly,
  helpResolutionController.setStatus,
);
helpResolutionRouter.post(
  '/admin/cases/:caseId/resolve',
  ...adminOnly,
  helpResolutionController.resolveCase,
);

helpResolutionRouter.get('/availability', helpResolutionController.getAvailability);
helpResolutionRouter.get('/cases', helpResolutionController.listCases);
helpResolutionRouter.post('/cases', helpResolutionController.createCase);
// Historical deep links: /app/support?ticketId=… and /app/disputes?disputeId=…
helpResolutionRouter.get(
  '/cases/by-support-ticket/:ticketId',
  helpResolutionController.getCaseBySupportTicket,
);
helpResolutionRouter.get(
  '/cases/by-reservation-dispute/:disputeId',
  helpResolutionController.getCaseByReservationDispute,
);
helpResolutionRouter.get('/cases/:caseId', helpResolutionController.getCase);
helpResolutionRouter.post('/cases/:caseId/messages', helpResolutionController.postMessage);
helpResolutionRouter.post('/cases/:caseId/evidence', helpResolutionController.addEvidence);
helpResolutionRouter.post('/cases/:caseId/escalate', helpResolutionController.escalate);

export { helpResolutionRouter };
