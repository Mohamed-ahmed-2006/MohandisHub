import { Router } from 'express';

import { authenticate } from '../../middleware/authenticate.js';
import { requireEmailVerified } from '../../middleware/require-email-verified.js';

import { providerPaymentsController } from './provider-payments.controller.js';

const providerPaymentsRouter = Router();

providerPaymentsRouter.use(authenticate, requireEmailVerified);

// Provider-managed payment methods. Role is enforced in the service.
providerPaymentsRouter.get('/methods', providerPaymentsController.list);
providerPaymentsRouter.post('/methods', providerPaymentsController.create);
providerPaymentsRouter.put('/methods/:id', providerPaymentsController.update);
providerPaymentsRouter.delete('/methods/:id', providerPaymentsController.remove);

// A provider's audit trail of who has seen their details.
providerPaymentsRouter.get('/disclosures', providerPaymentsController.myDisclosures);

// Customer-facing: only the customer of an ACTIVATED award may read these, and
// the read is audited.
providerPaymentsRouter.get(
  '/disclosure/award/:bidId',
  providerPaymentsController.discloseForAward,
);

export { providerPaymentsRouter };
