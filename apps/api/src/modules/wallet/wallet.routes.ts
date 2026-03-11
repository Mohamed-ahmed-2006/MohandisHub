// ---------------------------------------------------------------------------
// Wallet routes - authenticated user wallet endpoints
// ---------------------------------------------------------------------------

import { Router } from 'express';

import { authenticate } from '../../middleware/authenticate.js';
import { requireEmailVerified } from '../../middleware/require-email-verified.js';

import { walletController } from './wallet.controller.js';

const walletRouter = Router();

walletRouter.use(authenticate, requireEmailVerified);

walletRouter.get('/me', walletController.getMyWallet);
walletRouter.get('/me/transactions', walletController.getMyTransactions);
walletRouter.get('/deposit/currencies', walletController.getDepositCurrencies);
walletRouter.post('/deposit/checkout', walletController.createDepositCheckout);
// Legacy aliases kept for rollout compatibility
walletRouter.post('/deposit/crypto', walletController.createLegacyCryptoDeposit);
walletRouter.post('/deposit/stripe', walletController.createLegacyCardDeposit);
walletRouter.post('/deposit/confirm-stripe', walletController.confirmLegacyStripeSession);

walletRouter.get('/withdrawals', walletController.listWithdrawals);
walletRouter.post('/withdrawals', walletController.createWithdrawal);
walletRouter.post('/withdrawals/:withdrawalId/verify', walletController.verifyWithdrawal);

export { walletRouter };
