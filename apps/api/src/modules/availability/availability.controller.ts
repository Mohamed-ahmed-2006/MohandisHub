import { asyncHandler } from '../../utils/async-handler.js';
import { HttpError } from '../../utils/http-error.js';

import { AvailabilityService } from './availability.service.js';
import {
  createSlotSchema,
  createSlotsSchema,
  updateSlotSchema,
} from './availability.validation.js';

const svc = new AvailabilityService();

function requireUser(req: { user?: { id: string; role?: string } }) {
  if (!req.user)
    throw new HttpError({ statusCode: 401, code: 'UNAUTHORIZED', message: 'Auth required.' });
  return req.user;
}

function parseBody<T>(
  schema: {
    safeParse: (data: unknown) => {
      success: boolean;
      data?: T;
      error?: { flatten: () => { fieldErrors: unknown } };
    };
  },
  body: unknown,
): T {
  const result = schema.safeParse(body);
  if (!result.success) {
    throw new HttpError({
      statusCode: 400,
      code: 'VALIDATION_ERROR',
      message: 'Invalid input.',
      details: result.error!.flatten().fieldErrors,
    });
  }
  return result.data as T;
}

const list = asyncHandler(async (req, res) => {
  const user = requireUser(req);
  const providerId = (req.query.providerId as string) || user.id;
  const from = req.query.from as string;
  const to = req.query.to as string;
  if (!from || !to) {
    throw new HttpError({
      statusCode: 400,
      code: 'MISSING_PARAMS',
      message: 'from and to query params are required.',
    });
  }
  const isOwnSlots = providerId === user.id;
  const availableOnly = isOwnSlots ? req.query.availableOnly === 'true' : true;
  const data = await svc.list(providerId, from, to, availableOnly);
  res.json({ ok: true, data });
});

const create = asyncHandler(async (req, res) => {
  const user = requireUser(req);
  const input = parseBody(createSlotSchema, req.body);
  const slot = await svc.create(user.id, input);
  res.status(201).json({ ok: true, data: slot });
});

const createMany = asyncHandler(async (req, res) => {
  const user = requireUser(req);
  const input = parseBody(createSlotsSchema, req.body);
  const data = await svc.createMany(user.id, input);
  res.status(201).json({ ok: true, data });
});

const update = asyncHandler(async (req, res) => {
  const user = requireUser(req);
  const input = parseBody(updateSlotSchema, req.body);
  const slot = await svc.update(req.params.id!, user.id, input);
  res.json({ ok: true, data: slot });
});

const remove = asyncHandler(async (req, res) => {
  const user = requireUser(req);
  await svc.delete(req.params.id!, user.id);
  res.json({ ok: true, data: { deleted: true } });
});

export const availabilityController = {
  list,
  create,
  createMany,
  update,
  remove,
};
