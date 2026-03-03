import { Router } from 'express';

import { walletController } from './wallet.controller.js';

const walletRouter = Router();

walletRouter.get('/', walletController.status);

export { walletRouter };
