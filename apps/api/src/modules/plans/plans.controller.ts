import type { ApiSuccessBody, Plan } from '@mohandishub/shared';

import { asyncHandler } from '../../utils/async-handler.js';
import { HttpError } from '../../utils/http-error.js';

import { PlansService } from './plans.service.js';

const plansService = new PlansService();

const listActivePlans = asyncHandler(async (_req, res) => {
  const plans = await plansService.listActivePlans();
  const response: ApiSuccessBody<Plan[]> = { ok: true, data: plans };
  res.json(response);
});

const subscribe = asyncHandler(async (req, res) => {
  const user = req.user;
  if (!user) {
    throw new HttpError({
      statusCode: 401,
      code: 'UNAUTHORIZED',
      message: 'Authentication required.',
    });
  }
  const { planId } = req.params;
  if (!planId) {
    throw new HttpError({
      statusCode: 400,
      code: 'MISSING_PLAN_ID',
      message: 'Plan ID is required.',
    });
  }
  const result = await plansService.subscribeToPlan(user.id, planId);
  const response: ApiSuccessBody<{ plan: Plan; walletBalance: number }> = {
    ok: true,
    data: result,
  };
  res.json(response);
});

export const plansController = { listActivePlans, subscribe };
