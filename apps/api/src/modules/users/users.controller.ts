import type { ApiSuccessBody, AuthUser } from '@mohandishub/shared';

import { getPool } from '../../db/pool.js';
import { asyncHandler } from '../../utils/async-handler.js';
import { HttpError } from '../../utils/http-error.js';

import { UsersService } from './users.service.js';
import type { UserSummary } from './users.types.js';
import {
  confirmEmailChangeSchema,
  requestEmailChangeSchema,
  updateAccountSchema,
} from './users.validation.js';

const usersService = new UsersService();

const listUsers = asyncHandler((_req, res) => {
  const users = usersService.listUsers();
  const response: ApiSuccessBody<UserSummary[]> = { ok: true, data: users };

  res.status(200).json(response);
});

const getUserById = asyncHandler((req, res) => {
  const id = req.params.id;

  if (!id) {
    throw new HttpError({
      statusCode: 400,
      code: 'INVALID_USER_ID',
      message: 'User id is required.',
    });
  }

  const user = usersService.getUserById(id);
  const response: ApiSuccessBody<UserSummary> = { ok: true, data: user };

  res.status(200).json(response);
});

const updateMe = asyncHandler(async (req, res) => {
  const user = req.user;
  if (!user) {
    throw new HttpError({
      statusCode: 401,
      code: 'UNAUTHORIZED',
      message: 'Authentication required.',
    });
  }

  const parsed = updateAccountSchema.safeParse(req.body);
  if (!parsed.success) {
    throw new HttpError({
      statusCode: 400,
      code: 'VALIDATION_ERROR',
      message: 'Invalid account data.',
      details: parsed.error.flatten().fieldErrors,
    });
  }

  const updated = await usersService.updateAccount(user.id, parsed.data);
  const response: ApiSuccessBody<AuthUser> = { ok: true, data: updated };
  res.status(200).json(response);
});

const requestEmailChange = asyncHandler(async (req, res) => {
  const user = req.user;
  if (!user) {
    throw new HttpError({
      statusCode: 401,
      code: 'UNAUTHORIZED',
      message: 'Authentication required.',
    });
  }

  const parsed = requestEmailChangeSchema.safeParse(req.body);
  if (!parsed.success) {
    throw new HttpError({
      statusCode: 400,
      code: 'VALIDATION_ERROR',
      message: 'Invalid email.',
      details: parsed.error.flatten().fieldErrors,
    });
  }

  const result = await usersService.requestEmailChange(user.id, parsed.data.newEmail);
  const response: ApiSuccessBody<typeof result> = { ok: true, data: result };
  res.status(200).json(response);
});

const confirmEmailChange = asyncHandler(async (req, res) => {
  const user = req.user;
  if (!user) {
    throw new HttpError({
      statusCode: 401,
      code: 'UNAUTHORIZED',
      message: 'Authentication required.',
    });
  }

  const parsed = confirmEmailChangeSchema.safeParse(req.body);
  if (!parsed.success) {
    throw new HttpError({
      statusCode: 400,
      code: 'VALIDATION_ERROR',
      message: 'Invalid code.',
      details: parsed.error.flatten().fieldErrors,
    });
  }

  const updated = await usersService.confirmEmailChange(user.id, parsed.data.code);
  const response: ApiSuccessBody<AuthUser> = { ok: true, data: updated };
  res.status(200).json(response);
});

const getMyActivity = asyncHandler(async (req, res) => {
  const user = req.user;
  if (!user) {
    throw new HttpError({
      statusCode: 401,
      code: 'UNAUTHORIZED',
      message: 'Authentication required.',
    });
  }

  const page = parseInt(req.query.page as string, 10) || 1;
  const limit = Math.min(parseInt(req.query.limit as string, 10) || 20, 50);
  const offset = (page - 1) * limit;

  const pool = getPool();
  const { rows } = await pool.query(
    `SELECT id, type, amount, balance_delta, balance_after, status, description, reference_type, created_at
     FROM transactions
     WHERE user_id = $1
     ORDER BY created_at DESC
     LIMIT $2::int OFFSET $3::int`,
    [user.id, limit, offset],
  );

  const { rows: countRows } = await pool.query(
    `SELECT count(*)::int AS total FROM transactions WHERE user_id = $1`,
    [user.id],
  );
  const total = (countRows[0] as { total: number }).total;

  const response: ApiSuccessBody<{
    items: typeof rows;
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  }> = {
    ok: true,
    data: {
      items: rows,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    },
  };
  res.json(response);
});

export const usersController = {
  listUsers,
  getUserById,
  updateMe,
  requestEmailChange,
  confirmEmailChange,
  getMyActivity,
};
