import { Router } from 'express';

import { authenticate } from '../../middleware/authenticate.js';
import { requireEmailVerified } from '../../middleware/require-email-verified.js';

import { favoritesController } from './favorites.controller.js';

const router = Router();
router.use(authenticate, requireEmailVerified);

router.post('/', favoritesController.add);
router.get('/', favoritesController.list);
router.get('/:targetType/:targetId', favoritesController.check);
router.delete('/:targetType/:targetId', favoritesController.remove);

export { router as favoritesRouter };
