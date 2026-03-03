// ---------------------------------------------------------------------------
// requireRole middleware — restricts access based on user role
// ---------------------------------------------------------------------------

import type { UserRole } from '@mohandishub/shared';
import type { RequestHandler } from 'express';

import { HttpError } from '../utils/http-error.js';

/**
 * Returns middleware that ensures `req.user.role` is one of the allowed roles.
 *
 * Must be used AFTER `authenticate` middleware.
 *
 * @example
 * router.get('/experts-only', authenticate, requireRole('expert'), handler);
 * router.get('/provider', authenticate, requireRole('expert', 'business'), handler);
 */
export const requireRole =
  (...roles: UserRole[]): RequestHandler =>
  (req, _res, next) => {
    const user = req.user;

    if (!user) {
      throw new HttpError({
        statusCode: 401,
        code: 'UNAUTHORIZED',
        message: 'Authentication required.',
      });
    }

    if (!roles.includes(user.role)) {
      throw new HttpError({
        statusCode: 403,
        code: 'FORBIDDEN',
        message: `This action requires one of the following roles: ${roles.join(', ')}.`,
      });
    }

    next();
  };
