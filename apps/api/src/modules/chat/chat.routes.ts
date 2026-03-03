import { Router } from 'express';

import { chatController } from './chat.controller.js';

const chatRouter = Router();

chatRouter.get('/', chatController.status);

export { chatRouter };
