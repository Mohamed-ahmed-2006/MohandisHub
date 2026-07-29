import { Router } from 'express';

import { maintenanceMode } from '../middleware/maintenance-mode.js';
import { apiRateLimiter, authRateLimiter } from '../middleware/rate-limit.js';
import { adminRouter } from '../modules/admin/admin.routes.js';
import { advertisementsRouter } from '../modules/advertisements/advertisements.routes.js';
import { analyticsRouter } from '../modules/analytics/analytics.routes.js';
import { appRouter } from '../modules/app/app.routes.js';
import { authRouter } from '../modules/auth/auth.routes.js';
import { businessTeamsRouter } from '../modules/business-teams/business-teams.routes.js';
import { chatRouter } from '../modules/chat/chat.routes.js';
import { couponsRouter } from '../modules/coupons/coupons.routes.js';
import { favoritesRouter } from '../modules/favorites/favorites.routes.js';
import { geoRouter } from '../modules/geo/geo.routes.js';
import { jobsRouter } from '../modules/jobs/jobs.routes.js';
import { mediaRouter } from '../modules/media/media.routes.js';
import { mhcRouter } from '../modules/mhc/mhc.routes.js';
import { needsRouter, bidsRouter } from '../modules/needs/needs.routes.js';
import { negotiationsRouter } from '../modules/negotiations/negotiations.routes.js';
import { notificationsRouter } from '../modules/notifications/notifications.routes.js';
import { otpRouter } from '../modules/otp/otp.routes.js';
import { plansRouter } from '../modules/plans/plans.routes.js';
import { profilesRouter } from '../modules/profiles/profiles.routes.js';
import { providerPaymentsRouter } from '../modules/provider-payments/provider-payments.routes.js';
import { recommendationsRouter } from '../modules/recommendations/recommendations.routes.js';
import { reservationsRouter } from '../modules/reservations/reservations.routes.js';
import { reviewsRouter } from '../modules/reviews/reviews.routes.js';
import { savedSearchesRouter } from '../modules/saved-searches/saved-searches.routes.js';
import { servicesRouter } from '../modules/services/services.routes.js';
import { supportRouter } from '../modules/support/support.routes.js';
import { uploadRouter } from '../modules/upload/upload.routes.js';
import { usersRouter } from '../modules/users/users.routes.js';
import { verificationRouter } from '../modules/verification/verification.routes.js';
import { walletRouter } from '../modules/wallet/wallet.routes.js';
import { asyncHandler } from '../utils/async-handler.js';

/** Paths under `/api` that use `authRateLimiter` only — avoid counting them against the global API bucket (login was 429 after normal browsing). */
function isAuthOrOtpPath(path: string) {
  return (
    path === '/auth' || path.startsWith('/auth/') || path === '/otp' || path.startsWith('/otp/')
  );
}

/**
 * High-frequency read endpoints used by normal UI polling/focus refresh.
 * Keep them outside the strict global bucket to avoid false-positive 429s
 * during regular app usage (especially with multiple open tabs/sessions).
 */
function isApiRateLimitExemptPath(path: string) {
  return (
    path === '/app/status' ||
    path === '/wallet/me' ||
    path === '/reservations/profile/me' ||
    path.startsWith('/reservations/profile/')
  );
}

const apiRouter = Router();

apiRouter.use(asyncHandler(maintenanceMode));
apiRouter.use((req, res, next) => {
  if (isAuthOrOtpPath(req.path)) return next();
  if (isApiRateLimitExemptPath(req.path)) return next();
  return apiRateLimiter(req, res, next);
});
apiRouter.use('/app', appRouter);
apiRouter.use('/auth', authRateLimiter, authRouter);
apiRouter.use('/business-teams', businessTeamsRouter);
apiRouter.use('/otp', authRateLimiter, otpRouter);
apiRouter.use('/users', usersRouter);
apiRouter.use('/profiles', profilesRouter);
apiRouter.use('/recommendations', recommendationsRouter);
apiRouter.use('/admin', adminRouter);
apiRouter.use('/analytics', analyticsRouter);
apiRouter.use('/advertisements', advertisementsRouter);
apiRouter.use('/support', supportRouter);
apiRouter.use('/services', servicesRouter);
apiRouter.use('/wallet', walletRouter);
apiRouter.use('/credits', mhcRouter);
apiRouter.use('/provider-payments', providerPaymentsRouter);

apiRouter.use('/chat', chatRouter);
apiRouter.use('/coupons', couponsRouter);
apiRouter.use('/favorites', favoritesRouter);
apiRouter.use('/verification', verificationRouter);
apiRouter.use('/upload', uploadRouter);
apiRouter.use('/plans', plansRouter);
apiRouter.use('/negotiations', negotiationsRouter);
apiRouter.use('/needs', needsRouter);
apiRouter.use('/bids', bidsRouter);
apiRouter.use('/reservations', reservationsRouter);
apiRouter.use('/reviews', reviewsRouter);
apiRouter.use('/saved-searches', savedSearchesRouter);
apiRouter.use('/jobs', jobsRouter);
apiRouter.use('/notifications', notificationsRouter);
apiRouter.use('/geo', geoRouter);
apiRouter.use('/media', mediaRouter);

export { apiRouter };
