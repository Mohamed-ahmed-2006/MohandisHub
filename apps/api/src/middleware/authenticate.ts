// ---------------------------------------------------------------------------
// authenticate middleware — verifies JWT, attaches user context to request
// ---------------------------------------------------------------------------

import type { AccessTokenPayload, UserRole } from '@mohandishub/shared';
import type { RequestHandler } from 'express';

import { verifyAccessToken } from '../config/jwt.js';
import { getPool, hasDatabaseConfig } from '../db/pool.js';
import { HttpError } from '../utils/http-error.js';

/**
 * Express-compatible user context extracted from a valid JWT.
 * Merge this into Express.Request via module augmentation.
 */
export type RequestUser = {
  id: string;
  role: UserRole;
  isAdmin: boolean;
  adminPermissions?: string[];
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
      let currentUser: RequestUser = {
        id: payload.sub,
        role: payload.role,
        isAdmin: payload.isAdmin === true,
        verified: payload.verified,
        emailVerified: payload.emailVerified,
      };

      if (hasDatabaseConfig()) {
        const { rows } = await getPool().query<{
          primary_role: UserRole;
          is_admin: boolean;
          admin_permissions: string[] | null;
          is_active: boolean;
          email_verified_at: Date | null;
        }>(
          `SELECT primary_role,
                  COALESCE(is_admin, false) AS is_admin,
                  COALESCE(admin_permissions, '[]'::jsonb) AS admin_permissions,
                  COALESCE(is_active, false) AS is_active,
                  email_verified_at
             FROM users
            WHERE id = $1 AND deleted_at IS NULL
            LIMIT 1`,
          [payload.sub],
        );
        const row = rows[0];
        if (!row || row.is_active !== true) {
          throw new HttpError({
            statusCode: 401,
            code: 'ACCOUNT_DISABLED',
            message: 'This account is no longer active.',
          });
        }
        currentUser = {
          ...currentUser,
          role: row.primary_role,
          isAdmin: row.is_admin === true,
          adminPermissions: Array.isArray(row.admin_permissions) ? row.admin_permissions : [],
          emailVerified: row.email_verified_at !== null,
        };
      }

      req.user = currentUser;

      next();
    } catch (e) {
      next(e);
    }
  })();
};
