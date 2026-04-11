import { Router } from 'express';

import { authenticate } from '../../middleware/authenticate.js';
import { requireEmailVerified } from '../../middleware/require-email-verified.js';

import { negotiationsController } from './negotiations.controller.js';

const router = Router();
router.use(authenticate, requireEmailVerified);

router.post('/', negotiationsController.create);
router.get('/', negotiationsController.list);
router.get('/:id', negotiationsController.getById);
router.post('/:id/respond', negotiationsController.respond);
router.post('/:id/cancel', negotiationsController.cancel);

export { router as negotiationsRouter };
