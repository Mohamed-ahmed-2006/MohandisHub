import { Router } from 'express';

import { authRouter } from '../modules/auth/auth.routes.js';
import { chatRouter } from '../modules/chat/chat.routes.js';
import { otpRouter } from '../modules/otp/otp.routes.js';
import { adminRouter, profilesRouter } from '../modules/profiles/profiles.routes.js';
import { servicesRouter } from '../modules/services/services.routes.js';
import { usersRouter } from '../modules/users/users.routes.js';
import { verificationRouter } from '../modules/verification/verification.routes.js';
import { walletRouter } from '../modules/wallet/wallet.routes.js';

const apiRouter = Router();

apiRouter.use('/auth', authRouter);
apiRouter.use('/otp', otpRouter);
apiRouter.use('/users', usersRouter);
apiRouter.use('/profiles', profilesRouter);
apiRouter.use('/admin', adminRouter);
apiRouter.use('/services', servicesRouter);
apiRouter.use('/wallet', walletRouter);
apiRouter.use('/chat', chatRouter);
apiRouter.use('/verification', verificationRouter);

export { apiRouter };
