// ---------------------------------------------------------------------------
// MHC (Mohandis Credits) routes — provider credit endpoints
// ---------------------------------------------------------------------------

import { Router } from 'express';

import { authenticate } from '../../middleware/authenticate.js';
import { requireEmailVerified } from '../../middleware/require-email-verified.js';

import { mhcController } from './mhc.controller.js';

const mhcRouter = Router();

mhcRouter.use(authenticate, requireEmailVerified);

// Balance + history (provider-only; enforced in the service by role).
mhcRouter.get('/me', mhcController.getMyCredits);
mhcRouter.get('/me/transactions', mhcController.getMyCreditTransactions);

// Catalogue: what credits cost, and what actions cost.
mhcRouter.get('/packages', mhcController.getPackages);
mhcRouter.get('/action-prices', mhcController.getActionPrices);

// Purchase credits via manual InstaPay transfer (launch rail).
mhcRouter.get('/purchase/instapay/info', mhcController.getInstapayPurchaseInfo);
mhcRouter.post('/purchase/instapay', mhcController.submitInstapayPurchase);
// Automated crypto purchase (NOWPayments). Fail-closed on missing config.
mhcRouter.post('/purchase/nowpayments', mhcController.createNowPaymentsPurchase);
// The provider's own purchase history, including requests awaiting review.
mhcRouter.get('/purchases', mhcController.getMyCreditPurchases);

// Award activation — the provider spends MHC to unlock an awarded job.
mhcRouter.get('/activations/award/:bidId', mhcController.getAwardActivationStatus);
mhcRouter.post('/activations/award/:bidId', mhcController.activateAward);
// Declining is free: the need reopens and no credits are charged.
mhcRouter.post('/activations/award/:bidId/decline', mhcController.rejectAward);

export { mhcRouter };
