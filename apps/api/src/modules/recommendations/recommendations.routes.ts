import { Router } from 'express';

import { authenticate } from '../../middleware/authenticate.js';
import { requireEmailVerified } from '../../middleware/require-email-verified.js';

import { recommendationsController } from './recommendations.controller.js';

const recommendationsRouter = Router();

recommendationsRouter.use(authenticate, requireEmailVerified);
recommendationsRouter.get('/', recommendationsController.listRecommendations);
recommendationsRouter.get('/consent', recommendationsController.getConsent);
recommendationsRouter.patch('/consent', recommendationsController.setConsent);
recommendationsRouter.post('/events', recommendationsController.recordEvent);
recommendationsRouter.delete('/events', recommendationsController.clearEvents);

export { recommendationsRouter };
