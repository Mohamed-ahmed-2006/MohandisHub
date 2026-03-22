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
walletRouter.get('/me/transactions/:id/receipt', walletController.getReceipt);
walletRouter.get('/deposit/currencies', walletController.getDepositCurrencies);
walletRouter.get('/deposit/estimate', walletController.getDepositEstimate);
walletRouter.get('/deposit/instapay/info', walletController.getInstapayDepositInfo);
walletRouter.post('/deposits/instapay', walletController.submitInstapayDeposit);
walletRouter.post('/deposit/checkout', walletController.createDepositCheckout);
// Legacy aliases kept for rollout compatibility
walletRouter.post('/deposit/crypto', walletController.createLegacyCryptoDeposit);
walletRouter.post('/deposit/stripe', walletController.createLegacyCardDeposit);
walletRouter.post('/deposit/confirm-stripe', walletController.confirmLegacyStripeSession);

walletRouter.get('/withdrawals', walletController.listWithdrawals);
walletRouter.get('/withdrawals/quote', walletController.getWithdrawalQuote);
walletRouter.post('/withdrawals', walletController.createWithdrawal);
walletRouter.post('/withdrawals/:withdrawalId/cancel', walletController.cancelWithdrawal);
walletRouter.post('/withdrawals/:withdrawalId/verify', walletController.verifyWithdrawal);

export { walletRouter };
