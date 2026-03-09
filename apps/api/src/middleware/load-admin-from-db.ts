// ---------------------------------------------------------------------------
// loadAdminFromDb — ensures req.user.isAdmin reflects the database
// ---------------------------------------------------------------------------
//
// Use after authenticate. The JWT may have a stale isAdmin flag (e.g. user
// was granted admin after login). This middleware loads the current is_admin
// from the database so admin routes allow access without requiring re-login.

import type { RequestHandler } from 'express';

import { getPool } from '../db/pool.js';
import { HttpError } from '../utils/http-error.js';

export const loadAdminFromDb: RequestHandler = (req, _res, next) => {
  void (async () => {
    try {
      const user = req.user;

      if (!user) {
        throw new HttpError({
          statusCode: 401,
          code: 'UNAUTHORIZED',
          message: 'Authentication required.',
        });
      }

      const { rows } = await getPool().query<{ is_admin: boolean; admin_permissions?: string[] }>(
        `SELECT COALESCE(is_admin, false) AS is_admin, admin_permissions FROM users WHERE id = $1 AND deleted_at IS NULL LIMIT 1`,
        [user.id],
      );

      if (rows[0]) {
        (req as { user: { isAdmin: boolean; adminPermissions?: string[] } }).user = {
          ...req.user!,
          isAdmin: rows[0].is_admin === true,
          adminPermissions: Array.isArray(rows[0].admin_permissions) ? rows[0].admin_permissions : [],
        };
      }

      next();
    } catch (e) {
      next(e);
    }
  })();
};
