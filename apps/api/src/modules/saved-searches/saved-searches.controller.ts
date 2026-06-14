import type { ApiSuccessBody } from '@mohandishub/shared';

import { asyncHandler } from '../../utils/async-handler.js';
import { HttpError } from '../../utils/http-error.js';

import { SavedSearchesRepository } from './saved-searches.repository.js';
import { savedSearchKindSchema, upsertSavedSearchSchema } from './saved-searches.validation.js';

const repo = new SavedSearchesRepository();

function requireUserId(req: { user?: { id: string } }) {
  if (!req.user?.id) {
    throw new HttpError({
      statusCode: 401,
      code: 'UNAUTHORIZED',
      message: 'Authentication required.',
    });
  }
  return req.user.id;
}

export const listSavedSearches = asyncHandler(async (req, res) => {
  const kindParsed = req.query.kind ? savedSearchKindSchema.safeParse(req.query.kind) : null;
  if (kindParsed && !kindParsed.success) {
    throw new HttpError({
      statusCode: 400,
      code: 'VALIDATION_ERROR',
      message: 'Invalid search kind.',
    });
  }
  const items = await repo.list(requireUserId(req), kindParsed?.data);
  const response: ApiSuccessBody<{ items: typeof items }> = { ok: true, data: { items } };
  res.json(response);
});

export const createSavedSearch = asyncHandler(async (req, res) => {
  const parsed = upsertSavedSearchSchema.safeParse(req.body);
  if (!parsed.success) {
    throw new HttpError({
      statusCode: 400,
      code: 'VALIDATION_ERROR',
      message: 'Invalid saved search.',
      details: parsed.error.flatten().fieldErrors,
    });
  }
  const data = await repo.create(requireUserId(req), parsed.data);
  const response: ApiSuccessBody<typeof data> = { ok: true, data };
  res.status(201).json(response);
});

export const updateSavedSearch = asyncHandler(async (req, res) => {
  const parsed = upsertSavedSearchSchema.safeParse(req.body);
  if (!parsed.success) {
    throw new HttpError({
      statusCode: 400,
      code: 'VALIDATION_ERROR',
      message: 'Invalid saved search.',
      details: parsed.error.flatten().fieldErrors,
    });
  }
  const data = await repo.update(requireUserId(req), req.params.id!, parsed.data);
  if (!data)
    throw new HttpError({ statusCode: 404, code: 'NOT_FOUND', message: 'Saved search not found.' });
  const response: ApiSuccessBody<typeof data> = { ok: true, data };
  res.json(response);
});

export const markSavedSearchViewed = asyncHandler(async (req, res) => {
  const body = req.body as { resultCount?: unknown } | undefined;
  const resultCountRaw =
    typeof body?.resultCount === 'number' || typeof body?.resultCount === 'string'
      ? String(body.resultCount)
      : '0';
  const resultCount = Math.max(0, parseInt(resultCountRaw, 10) || 0);
  const data = await repo.markViewed(requireUserId(req), req.params.id!, resultCount);
  if (!data)
    throw new HttpError({ statusCode: 404, code: 'NOT_FOUND', message: 'Saved search not found.' });
  const response: ApiSuccessBody<typeof data> = { ok: true, data };
  res.json(response);
});

export const deleteSavedSearch = asyncHandler(async (req, res) => {
  const deleted = await repo.delete(requireUserId(req), req.params.id!);
  const response: ApiSuccessBody<{ deleted: boolean }> = { ok: true, data: { deleted } };
  res.json(response);
});

export const savedSearchesController = {
  listSavedSearches,
  createSavedSearch,
  updateSavedSearch,
  markSavedSearchViewed,
  deleteSavedSearch,
};
