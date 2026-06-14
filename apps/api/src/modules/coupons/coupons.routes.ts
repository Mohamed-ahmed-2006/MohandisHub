import { Router } from 'express';

import { authenticate } from '../../middleware/authenticate.js';
import { requireEmailVerified } from '../../middleware/require-email-verified.js';

import { couponsController } from './coupons.controller.js';

const couponsRouter = Router();

couponsRouter.use(authenticate, requireEmailVerified);
couponsRouter.post('/validate', couponsController.validateCoupon);
couponsRouter.post('/apply', couponsController.applyCoupon);
couponsRouter.get('/campaigns/me', couponsController.listMyCampaigns);
couponsRouter.post('/campaigns/preview', couponsController.previewProviderCampaign);
couponsRouter.post('/campaigns', couponsController.createProviderCampaign);

export { couponsRouter };
