// ---------------------------------------------------------------------------
// Support routes — user tickets (authenticated)
// ---------------------------------------------------------------------------

import { Router } from 'express';

import { authenticate } from '../../middleware/authenticate.js';
import { requireEmailVerified } from '../../middleware/require-email-verified.js';

import { supportController } from './support.controller.js';

const supportRouter = Router();

supportRouter.use(authenticate, requireEmailVerified);

supportRouter.post('/tickets', supportController.createTicket);
supportRouter.get('/tickets', supportController.listMyTickets);
supportRouter.get('/tickets/:ticketId', supportController.getTicket);
supportRouter.get('/tickets/:ticketId/messages', supportController.listMessages);
supportRouter.post('/tickets/:ticketId/messages', supportController.reply);

export { supportRouter };
