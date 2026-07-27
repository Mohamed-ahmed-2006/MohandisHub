import type { ApiSuccessBody, RecommendationEventType } from '@mohandishub/shared';
import { z } from 'zod';

import { asyncHandler } from '../../utils/async-handler.js';
import { HttpError } from '../../utils/http-error.js';
import { parseLimit } from '../../utils/pagination.js';
import { ServicesService } from '../services/services.service.js';

import { RecommendationsRepository } from './recommendations.repository.js';

const repo = new RecommendationsRepository();
const services = new ServicesService();

const consentSchema = z.object({ enabled: z.boolean() });
const eventSchema = z.object({
  eventType: z.enum(['service_view', 'search', 'saved_search', 'booking', 'rating']),
  serviceId: z.string().uuid().optional(),
  categoryId: z.string().uuid().optional(),
  city: z.string().max(100).optional(),
  metadata: z.record(z.unknown()).optional(),
});

function requireUser(req: { user?: { id: string } }) {
  if (!req.user?.id) {
    throw new HttpError({
      statusCode: 401,
      code: 'UNAUTHORIZED',
      message: 'Authentication required.',
    });
  }
  return req.user;
}

export const getConsent = asyncHandler(async (req, res) => {
  const data = await repo.getConsent(requireUser(req).id);
  const response: ApiSuccessBody<typeof data> = { ok: true, data };
  res.json(response);
});

export const setConsent = asyncHandler(async (req, res) => {
  const parsed = consentSchema.safeParse(req.body);
  if (!parsed.success) {
    throw new HttpError({ statusCode: 400, code: 'VALIDATION_ERROR', message: 'Invalid consent.' });
  }
  const data = await repo.setConsent(requireUser(req).id, parsed.data.enabled);
  const response: ApiSuccessBody<typeof data> = { ok: true, data };
  res.json(response);
});

export const recordEvent = asyncHandler(async (req, res) => {
  const parsed = eventSchema.safeParse(req.body);
  if (!parsed.success) {
    throw new HttpError({
      statusCode: 400,
      code: 'VALIDATION_ERROR',
      message: 'Invalid recommendation event.',
      details: parsed.error.flatten().fieldErrors,
    });
  }
  const event = {
    eventType: parsed.data.eventType as RecommendationEventType,
    ...(parsed.data.serviceId ? { serviceId: parsed.data.serviceId } : {}),
    ...(parsed.data.categoryId ? { categoryId: parsed.data.categoryId } : {}),
    ...(parsed.data.city ? { city: parsed.data.city } : {}),
    ...(parsed.data.metadata ? { metadata: parsed.data.metadata } : {}),
  };
  await repo.recordEvent(requireUser(req).id, event);
  const response: ApiSuccessBody<{ recorded: boolean }> = { ok: true, data: { recorded: true } };
  res.status(202).json(response);
});

export const clearEvents = asyncHandler(async (req, res) => {
  const deleted = await repo.deleteEvents(requireUser(req).id);
  const response: ApiSuccessBody<{ deleted: number }> = { ok: true, data: { deleted } };
  res.json(response);
});

export const listRecommendations = asyncHandler(async (req, res) => {
  const user = requireUser(req);
  const limit = parseLimit(req.query.limit, { defaultLimit: 10, maxLimit: 20 });
  const consent = await repo.getConsent(user.id);
  const categoryId = consent.personalizedRecommendationsEnabled
    ? await repo.getTopCategory(user.id)
    : null;
  const items = await services.getRecommendedServices(limit, categoryId ?? undefined);
  const data = {
    consent,
    personalized: consent.personalizedRecommendationsEnabled && Boolean(categoryId),
    items,
  };
  const response: ApiSuccessBody<typeof data> = { ok: true, data };
  res.json(response);
});

export const recommendationsController = {
  getConsent,
  setConsent,
  recordEvent,
  clearEvents,
  listRecommendations,
};
