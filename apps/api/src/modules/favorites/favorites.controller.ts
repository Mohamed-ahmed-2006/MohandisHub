import type { ApiSuccessBody, Favorite } from '@mohandishub/shared';

import { asyncHandler } from '../../utils/async-handler.js';
import { HttpError } from '../../utils/http-error.js';

import { FavoritesService } from './favorites.service.js';
import { addFavoriteSchema } from './favorites.validation.js';

const svc = new FavoritesService();

function requireUser(req: { user?: { id: string } }) {
  if (!req.user)
    throw new HttpError({ statusCode: 401, code: 'UNAUTHORIZED', message: 'Auth required.' });
  return req.user.id;
}

function parseBody<T>(
  schema: { safeParse: (d: unknown) => { success: boolean; data?: T } },
  body: unknown,
): T {
  const r = schema.safeParse(body);
  if (!r.success)
    throw new HttpError({ statusCode: 400, code: 'VALIDATION_ERROR', message: 'Invalid input.' });
  return r.data as T;
}

const add = asyncHandler(async (req, res) => {
  const userId = requireUser(req);
  const input = parseBody(addFavoriteSchema, req.body);
  const favorite = await svc.add(userId, input.targetType, input.targetId);
  res.status(201).json({ ok: true, data: favorite } as ApiSuccessBody<Favorite | null>);
});

const remove = asyncHandler(async (req, res) => {
  const userId = requireUser(req);
  const targetType = req.params.targetType as 'provider' | 'service';
  const targetId = req.params.targetId!;
  if (targetType !== 'provider' && targetType !== 'service') {
    throw new HttpError({
      statusCode: 400,
      code: 'VALIDATION_ERROR',
      message: 'Invalid targetType.',
    });
  }
  await svc.remove(userId, targetType, targetId);
  res.json({ ok: true, data: { removed: true } });
});

const list = asyncHandler(async (req, res) => {
  const userId = requireUser(req);
  const targetType = req.query.targetType as 'provider' | 'service' | undefined;
  const items = await svc.list(userId, targetType);
  res.json({ ok: true, data: { items } });
});

const check = asyncHandler(async (req, res) => {
  const userId = requireUser(req);
  const targetType = req.params.targetType as 'provider' | 'service';
  const targetId = req.params.targetId!;
  if (targetType !== 'provider' && targetType !== 'service') {
    throw new HttpError({
      statusCode: 400,
      code: 'VALIDATION_ERROR',
      message: 'Invalid targetType.',
    });
  }
  const isFav = await svc.isFavorite(userId, targetType, targetId);
  res.json({ ok: true, data: { isFavorite: isFav } });
});

export const favoritesController = { add, remove, list, check };
