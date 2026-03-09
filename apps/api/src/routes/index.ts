import { Router } from 'express';

import { maintenanceMode } from '../middleware/maintenance-mode.js';
import { adminRouter } from '../modules/admin/admin.routes.js';
import { appRouter } from '../modules/app/app.routes.js';
import { authRouter } from '../modules/auth/auth.routes.js';
import { chatRouter } from '../modules/chat/chat.routes.js';
import { jobsRouter } from '../modules/jobs/jobs.routes.js';
import { needsRouter, bidsRouter } from '../modules/needs/needs.routes.js';
import { otpRouter } from '../modules/otp/otp.routes.js';
import { plansRouter } from '../modules/plans/plans.routes.js';
import { profilesRouter } from '../modules/profiles/profiles.routes.js';
import { reservationsRouter } from '../modules/reservations/reservations.routes.js';
import { reviewsRouter } from '../modules/reviews/reviews.routes.js';
import { servicesRouter } from '../modules/services/services.routes.js';
import { uploadRouter } from '../modules/upload/upload.routes.js';
import { usersRouter } from '../modules/users/users.routes.js';
import { verificationRouter } from '../modules/verification/verification.routes.js';
import { walletRouter } from '../modules/wallet/wallet.routes.js';
import { asyncHandler } from '../utils/async-handler.js';

const apiRouter = Router();

apiRouter.use(asyncHandler(maintenanceMode));
apiRouter.use('/app', appRouter);
apiRouter.use('/auth', authRouter);
apiRouter.use('/otp', otpRouter);
apiRouter.use('/users', usersRouter);
apiRouter.use('/profiles', profilesRouter);
apiRouter.use('/admin', adminRouter);
apiRouter.use('/services', servicesRouter);
apiRouter.use('/wallet', walletRouter);
apiRouter.use('/chat', chatRouter);
apiRouter.use('/verification', verificationRouter);
apiRouter.use('/upload', uploadRouter);
apiRouter.use('/plans', plansRouter);
apiRouter.use('/needs', needsRouter);
apiRouter.use('/bids', bidsRouter);
apiRouter.use('/reservations', reservationsRouter);
apiRouter.use('/reviews', reviewsRouter);
apiRouter.use('/jobs', jobsRouter);

export { apiRouter };
