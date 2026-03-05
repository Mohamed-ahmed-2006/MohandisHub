import { Router } from 'express';

import { servicesController } from './services.controller.js';

const servicesRouter = Router();

servicesRouter.get('/catalog', servicesController.catalog);
servicesRouter.get('/', servicesController.status);

export { servicesRouter };
