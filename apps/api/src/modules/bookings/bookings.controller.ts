import { asyncHandler } from '../../utils/async-handler.js';
import { HttpError } from '../../utils/http-error.js';

import { BookingsService } from './bookings.service.js';
import { createBookingSchema, updateBookingSchema } from './bookings.validation.js';

const svc = new BookingsService();

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

const create = asyncHandler(async (req, res) => {
  const user = requireUser(req);
  const input = parseBody(createBookingSchema, req.body);
  const booking = await svc.create(user.id, input);
  res.status(201).json({ ok: true, data: booking });
});

const listMy = asyncHandler(async (req, res) => {
  const user = requireUser(req);
  const role = (req.query.role as 'customer' | 'provider') || 'customer';
  const page = parseInt(req.query.page as string, 10) || 1;
  const limit = Math.min(parseInt(req.query.limit as string, 10) || 20, 50);
  const data = await svc.listMy(user.id, role, page, limit);
  res.json({ ok: true, data });
});

const getById = asyncHandler(async (req, res) => {
  const user = requireUser(req);
  const booking = await svc.getById(req.params.id!, user.id);
  res.json({ ok: true, data: booking });
});

const update = asyncHandler(async (req, res) => {
  const user = requireUser(req);
  const input = parseBody(updateBookingSchema, req.body);
  const booking = await svc.update(req.params.id!, user.id, input);
  res.json({ ok: true, data: booking });
});

export const bookingsController = {
  create,
  listMy,
  getById,
  update,
};
