// ---------------------------------------------------------------------------
// Notifications routes — user-facing list, unread count, mark read
// ---------------------------------------------------------------------------

import { Router } from 'express';

import { authenticate } from '../../middleware/authenticate.js';
import { requireEmailVerified } from '../../middleware/require-email-verified.js';

import { notificationsController } from './notifications.controller.js';

const notificationsRouter = Router();

notificationsRouter.use(authenticate, requireEmailVerified);

notificationsRouter.get('/', notificationsController.getNotifications);
notificationsRouter.get('/unread-count', notificationsController.getUnreadCount);
notificationsRouter.post('/demo', notificationsController.sendDemo);
notificationsRouter.patch('/read-all', notificationsController.markAllAsRead);
notificationsRouter.patch('/:id/read', notificationsController.markAsRead);

export { notificationsRouter };
