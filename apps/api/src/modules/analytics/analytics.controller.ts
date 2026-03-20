// ---------------------------------------------------------------------------
// Analytics controller — HTTP handlers for provider analytics
// ---------------------------------------------------------------------------

import type { ApiSuccessBody, ProviderAnalytics } from '@mohandishub/shared';
import { canAccessProviderAnalytics } from '@mohandishub/shared';

import { asyncHandler } from '../../utils/async-handler.js';
import { HttpError } from '../../utils/http-error.js';

import { AnalyticsService } from './analytics.service.js';

const analyticsService = new AnalyticsService();

function requireProvider(req: { user?: { id: string; role?: string } }): { id: string; role: string } {
  const user = req.user;
  if (!user) {
    throw new HttpError({ statusCode: 401, code: 'UNAUTHORIZED', message: 'Authentication required.' });
  }
  const role = user.role ?? 'customer';
  if (!canAccessProviderAnalytics(role)) {
    throw new HttpError({
      statusCode: 403,
      code: 'FORBIDDEN',
      message: 'Analytics are available only for provider accounts.',
    });
  }
  return { id: user.id, role };
}

const getMyAnalytics = asyncHandler(async (req, res) => {
  const { id } = requireProvider(req);
  const data: ProviderAnalytics = await analyticsService.getProviderAnalytics(id);
  const response: ApiSuccessBody<ProviderAnalytics> = { ok: true, data };
  res.json(response);
});

export const analyticsController = {
  getMyAnalytics,
};
