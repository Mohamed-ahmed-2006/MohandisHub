// ---------------------------------------------------------------------------
// Services routes — public service browsing endpoints
// ---------------------------------------------------------------------------

import { Router } from 'express';

import { servicesController } from './services.controller.js';

const servicesRouter = Router();

servicesRouter.get('/categories', servicesController.listCategories);
servicesRouter.get('/search', servicesController.searchServices);
servicesRouter.get('/:id', servicesController.getServiceDetail);

export { servicesRouter };
