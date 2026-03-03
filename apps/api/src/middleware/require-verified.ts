// ---------------------------------------------------------------------------
// requireVerified middleware — ensures expert / business is verified
// ---------------------------------------------------------------------------

import { isVerifiableRole } from '@mohandishub/shared';
import type { RequestHandler } from 'express';

import { HttpError } from '../utils/http-error.js';

/**
 * Middleware that checks `req.user.verified === true` for roles that
 * require verification (expert, business). Customers pass through.
 *
 * Must be used AFTER `authenticate`.
 *
 * @example
 * router.post('/create-listing', authenticate, requireVerified, handler);
 */
export const requireVerified: RequestHandler = (req, _res, next) => {
  const user = req.user;

  if (!user) {
    throw new HttpError({
      statusCode: 401,
      code: 'UNAUTHORIZED',
      message: 'Authentication required.',
    });
  }

  // Customers don't need verification
  if (!isVerifiableRole(user.role)) {
    next();
    return;
  }

  if (!user.verified) {
    throw new HttpError({
      statusCode: 403,
      code: 'VERIFICATION_REQUIRED',
      message:
        'Your account must be verified before performing this action. Please complete the verification process.',
    });
  }

  next();
};
