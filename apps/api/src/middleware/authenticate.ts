// ---------------------------------------------------------------------------
// authenticate middleware — verifies JWT, attaches user context to request
// ---------------------------------------------------------------------------

import type { AccessTokenPayload, UserRole } from '@mohandishub/shared';
import type { RequestHandler } from 'express';

import { verifyAccessToken } from '../config/jwt.js';
import { hasDatabaseConfig } from '../db/pool.js';
import { HttpError } from '../utils/http-error.js';

import { isUserActive } from './user-status-cache.js';

/**
 * Express-compatible user context extracted from a valid JWT.
 * Merge this into Express.Request via module augmentation.
 */
export type RequestUser = {
  id: string;
  role: UserRole;
  isAdmin: boolean;
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
  void (async () => {
    try {
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

      // Reject tokens for accounts that have been deactivated or deleted since
      // the access token was issued. A valid signature is not enough — the JWT
      // is short-lived but an admin action must take effect promptly.
      if (hasDatabaseConfig()) {
        const active = await isUserActive(payload.sub);
        if (!active) {
          throw new HttpError({
            statusCode: 401,
            code: 'ACCOUNT_DISABLED',
            message: 'This account is no longer active.',
          });
        }
      }

      req.user = {
        id: payload.sub,
        role: payload.role,
        isAdmin: payload.isAdmin === true,
        verified: payload.verified,
        emailVerified: payload.emailVerified,
      };

      next();
    } catch (e) {
      next(e);
    }
  })();
};
