// ---------------------------------------------------------------------------
// Wallet routes - authenticated user wallet endpoints
// ---------------------------------------------------------------------------

import { Router } from 'express';

import { authenticate } from '../../middleware/authenticate.js';
import { requireEmailVerified } from '../../middleware/require-email-verified.js';
import {
  DEPOSIT_RAIL_KEYS,
  WITHDRAWAL_RAIL_KEYS,
  retiredMoneyRoute,
} from '../../middleware/retired-money-route.js';

import { walletController } from './wallet.controller.js';

const walletRouter = Router();

walletRouter.use(authenticate, requireEmailVerified);

// ---------------------------------------------------------------------------
// KEPT OPEN — deliberately, and this list is the contract (P0-08).
// ---------------------------------------------------------------------------
// Providers and admins still need the historic ledger: the money wallets are
// frozen, not erased, and admin money-audit tooling reads through these.
// Removing any of them would hide real financial history.
walletRouter.get('/me', walletController.getMyWallet);
walletRouter.get('/me/transactions', walletController.getMyTransactions);
walletRouter.get('/me/transactions/:id/receipt', walletController.getReceipt);
// Read-only helpers with no money effect; also still used to render history.
walletRouter.get('/deposit/currencies', walletController.getDepositCurrencies);
walletRouter.get('/deposit/estimate', walletController.getDepositEstimate);
walletRouter.get('/deposit/instapay/info', walletController.getInstapayDepositInfo);
// A provider's own withdrawal history. The list is history; only the actions
// below are retired.
walletRouter.get('/withdrawals', walletController.listWithdrawals);

// ---------------------------------------------------------------------------
// RETIRED — fenced fail-closed, handlers deliberately left in place.
// ---------------------------------------------------------------------------
// Every route below returns 410 unless an admin explicitly re-enables its rail.
// The controllers and services are untouched so the behaviour, the validation
// and the ledger semantics all remain auditable and reversible.
const depositRetired = retiredMoneyRoute('deposit', DEPOSIT_RAIL_KEYS);
const withdrawalRetired = retiredMoneyRoute('withdrawal', WITHDRAWAL_RAIL_KEYS);

walletRouter.post('/deposits/instapay', depositRetired, walletController.submitInstapayDeposit);
walletRouter.post('/deposit/checkout', depositRetired, walletController.createDepositCheckout);
// Legacy aliases kept for rollout compatibility
walletRouter.post('/deposit/crypto', depositRetired, walletController.createLegacyCryptoDeposit);
walletRouter.post('/deposit/stripe', depositRetired, walletController.createLegacyCardDeposit);
walletRouter.post(
  '/deposit/confirm-stripe',
  depositRetired,
  walletController.confirmLegacyStripeSession,
);

walletRouter.get('/withdrawals/quote', withdrawalRetired, walletController.getWithdrawalQuote);
walletRouter.post('/withdrawals', withdrawalRetired, walletController.createWithdrawal);
walletRouter.post(
  '/withdrawals/:withdrawalId/cancel',
  withdrawalRetired,
  walletController.cancelWithdrawal,
);
walletRouter.post(
  '/withdrawals/:withdrawalId/verify',
  withdrawalRetired,
  walletController.verifyWithdrawal,
);

export { walletRouter };
