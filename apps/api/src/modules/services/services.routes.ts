// ---------------------------------------------------------------------------
// Services routes — public browsing + provider CRUD
// ---------------------------------------------------------------------------

import { Router } from 'express';

import { authenticate } from '../../middleware/authenticate.js';
import { requireEmailVerified } from '../../middleware/require-email-verified.js';
import { requireRole } from '../../middleware/require-role.js';
import { requireVerified } from '../../middleware/require-verified.js';

import { servicesController } from './services.controller.js';

const servicesRouter = Router();

// Public
servicesRouter.get('/categories', servicesController.listCategories);
servicesRouter.get('/recommendations', servicesController.getRecommendations);
servicesRouter.get('/search', servicesController.searchServices);

// Provider endpoints (expert, business) — order matters: /my before /:id
const providerMw = [
  authenticate,
  requireEmailVerified,
  requireRole('expert', 'business', 'craftsman'),
];
const providerVerifiedMw = [...providerMw, requireVerified];
servicesRouter.get('/my', ...providerMw, servicesController.listMyServices);
servicesRouter.post('/', ...providerVerifiedMw, servicesController.createService);
servicesRouter.patch('/:id', ...providerMw, servicesController.updateService);
servicesRouter.delete('/:id', ...providerMw, servicesController.deleteService);
servicesRouter.post('/:id/submit', ...providerVerifiedMw, servicesController.submitService);
servicesRouter.post('/:id/pause', ...providerVerifiedMw, servicesController.pauseService);
servicesRouter.post('/:id/activate', ...providerVerifiedMw, servicesController.activateService);

// Public detail (must be after /my)
servicesRouter.get('/:id', servicesController.getServiceDetail);

export { servicesRouter };
