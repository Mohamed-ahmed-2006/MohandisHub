// ---------------------------------------------------------------------------
// Wallet routes — authenticated user wallet endpoints
// ---------------------------------------------------------------------------

import { Router } from 'express';

import { authenticate } from '../../middleware/authenticate.js';
import { requireEmailVerified } from '../../middleware/require-email-verified.js';

import { walletController } from './wallet.controller.js';

const walletRouter = Router();

walletRouter.use(authenticate, requireEmailVerified);

walletRouter.get('/me', walletController.getMyWallet);
walletRouter.get('/me/transactions', walletController.getMyTransactions);
walletRouter.post('/deposit/stripe', walletController.createStripeCheckout);
walletRouter.post('/deposit/crypto', walletController.createCryptoDeposit);
walletRouter.post('/deposit/confirm-stripe', walletController.confirmStripeSession);

export { walletRouter };
