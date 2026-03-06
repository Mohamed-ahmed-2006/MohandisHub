import type { ApiSuccessBody, AuthUser } from '@mohandishub/shared';

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

export const usersController = {
  listUsers,
  getUserById,
  updateMe,
  requestEmailChange,
  confirmEmailChange,
};
