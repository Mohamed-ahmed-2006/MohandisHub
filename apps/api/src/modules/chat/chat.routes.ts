import { Router } from 'express';

import { authenticate } from '../../middleware/authenticate.js';
import { requireEmailVerified } from '../../middleware/require-email-verified.js';

import { chatController } from './chat.controller.js';

const chatRouter = Router();

chatRouter.get('/', chatController.status);
chatRouter.get(
  '/conversations',
  authenticate,
  requireEmailVerified,
  chatController.listConversations,
);
chatRouter.post(
  '/conversations',
  authenticate,
  requireEmailVerified,
  chatController.startConversation,
);
chatRouter.get(
  '/conversations/:conversationId/messages',
  authenticate,
  requireEmailVerified,
  chatController.getMessages,
);
chatRouter.post(
  '/conversations/:conversationId/messages',
  authenticate,
  requireEmailVerified,
  chatController.sendMessage,
);
chatRouter.delete(
  '/conversations/:conversationId/messages/:messageId',
  authenticate,
  requireEmailVerified,
  chatController.deleteMessage,
);

export { chatRouter };
