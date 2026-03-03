import type { ApiSuccessBody } from '@mohandishub/shared';

import { asyncHandler } from '../../utils/async-handler.js';
import { HttpError } from '../../utils/http-error.js';

import { UsersService } from './users.service.js';
import type { UserSummary } from './users.types.js';

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

export const usersController = {
  listUsers,
  getUserById,
};
