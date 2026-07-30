import type {
  ApiSuccessBody,
  Plan,
  PlanUsageSummary,
  SubscribeToPlanResponse,
} from '@mohandishub/shared';

import { asyncHandler } from '../../utils/async-handler.js';
import { HttpError } from '../../utils/http-error.js';

import { PlansService } from './plans.service.js';

const plansService = new PlansService();

/**
 * Optional, matching the advertisements controller: plan subscribing predates
 * this header, so requiring it would reject every existing client. Supplying it
 * is what buys protection against a double click creating two subscriptions.
 */
function optionalIdempotencyKey(req: {
  header: (name: string) => string | undefined;
}): string | null {
  const key = req.header('Idempotency-Key')?.trim();
  if (!key) return null;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(key)) {
    throw new HttpError({
      statusCode: 400,
      code: 'IDEMPOTENCY_KEY_INVALID',
      message: 'Idempotency-Key must be a UUID.',
    });
  }
  return key;
}

const listActivePlans = asyncHandler(async (req, res) => {
  const user = req.user;
  if (!user) {
    throw new HttpError({
      statusCode: 401,
      code: 'UNAUTHORIZED',
      message: 'Authentication required.',
    });
  }
  const plans = await plansService.listActivePlansForRole(user.role);
  const response: ApiSuccessBody<Plan[]> = { ok: true, data: plans };
  res.json(response);
});

const getMyUsage = asyncHandler(async (req, res) => {
  const user = req.user;
  if (!user) {
    throw new HttpError({
      statusCode: 401,
      code: 'UNAUTHORIZED',
      message: 'Authentication required.',
    });
  }
  const usage = await plansService.getMyUsage(user.id);
  const response: ApiSuccessBody<PlanUsageSummary> = { ok: true, data: usage };
  res.json(response);
});

const getCurrentSubscription = asyncHandler(async (req, res) => {
  const user = req.user;
  if (!user) {
    throw new HttpError({
      statusCode: 401,
      code: 'UNAUTHORIZED',
      message: 'Authentication required.',
    });
  }
  const subscription = await plansService.getCurrentSubscription(user.id);
  const response: ApiSuccessBody<{ subscriptionEndsAt: string } | null> = {
    ok: true,
    data: subscription,
  };
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
  const result = await plansService.subscribeToPlan(user.id, planId, optionalIdempotencyKey(req));
  const response: ApiSuccessBody<SubscribeToPlanResponse> = {
    ok: true,
    data: result,
  };
  res.json(response);
});

export const plansController = { listActivePlans, getMyUsage, getCurrentSubscription, subscribe };
