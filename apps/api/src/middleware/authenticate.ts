// ---------------------------------------------------------------------------
// authenticate middleware — verifies JWT, attaches user context to request
// ---------------------------------------------------------------------------

import type { AccessTokenPayload, UserRole } from '@mohandishub/shared';
import type { RequestHandler } from 'express';

import { verifyAccessToken } from '../config/jwt.js';
import { HttpError } from '../utils/http-error.js';

/**
 * Express-compatible user context extracted from a valid JWT.
 * Merge this into Express.Request via module augmentation.
 */
export type RequestUser = {
  id: string;
  role: UserRole;
  verified: boolean;
  emailVerified: boolean;
};

// We augment Express so `req.user` is typed everywhere.
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: RequestUser;
    }
  }
}

/**
 * Middleware that reads the `Authorization: Bearer <token>` header,
 * verifies the JWT, and attaches `req.user`.
 *
 * Returns 401 if the token is missing or invalid.
 */
export const authenticate: RequestHandler = (req, _res, next) => {
  const header = req.headers.authorization;

  if (!header || !header.startsWith('Bearer ')) {
    throw new HttpError({
      statusCode: 401,
      code: 'UNAUTHORIZED',
      message: 'Missing or malformed Authorization header.',
    });
  }

  const token = header.slice(7); // strip "Bearer "

  let payload: AccessTokenPayload;

  try {
    payload = verifyAccessToken(token);
  } catch {
    throw new HttpError({
      statusCode: 401,
      code: 'INVALID_TOKEN',
      message: 'Access token is invalid or expired.',
    });
  }

  req.user = {
    id: payload.sub,
    role: payload.role,
    verified: payload.verified,
    emailVerified: payload.emailVerified,
  };

  next();
};
