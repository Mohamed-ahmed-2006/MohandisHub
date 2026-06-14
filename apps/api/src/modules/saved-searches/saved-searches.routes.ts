import { Router } from 'express';

import { authenticate } from '../../middleware/authenticate.js';
import { requireEmailVerified } from '../../middleware/require-email-verified.js';

import { savedSearchesController } from './saved-searches.controller.js';

const savedSearchesRouter = Router();

savedSearchesRouter.use(authenticate, requireEmailVerified);
savedSearchesRouter.get('/', savedSearchesController.listSavedSearches);
savedSearchesRouter.post('/', savedSearchesController.createSavedSearch);
savedSearchesRouter.patch('/:id', savedSearchesController.updateSavedSearch);
savedSearchesRouter.post('/:id/viewed', savedSearchesController.markSavedSearchViewed);
savedSearchesRouter.delete('/:id', savedSearchesController.deleteSavedSearch);

export { savedSearchesRouter };
