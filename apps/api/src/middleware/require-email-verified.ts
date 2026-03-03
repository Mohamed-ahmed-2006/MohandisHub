// ---------------------------------------------------------------------------
// requireEmailVerified middleware
// ---------------------------------------------------------------------------

import type { RequestHandler } from 'express';

import { HttpError } from '../utils/http-error.js';

/**
 * Middleware that ensures `req.user.emailVerified === true`.
 *
 * Must be used AFTER `authenticate`.
 */
export const requireEmailVerified: RequestHandler = (req, _res, next) => {
  const user = req.user;

  if (!user) {
    throw new HttpError({
      statusCode: 401,
      code: 'UNAUTHORIZED',
      message: 'Authentication required.',
    });
  }

  if (!user.emailVerified) {
    throw new HttpError({
      statusCode: 403,
      code: 'EMAIL_NOT_VERIFIED',
      message: 'Please verify your email address before continuing.',
    });
  }

  next();
};
