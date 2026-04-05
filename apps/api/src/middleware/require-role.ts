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

    // Admin is a flag: check isAdmin for 'admin' role
    const isAdminRequired = roles.includes('admin');
    if (isAdminRequired && user.isAdmin) {
      return next();
    }
    if (isAdminRequired && !user.isAdmin) {
      throw new HttpError({
        statusCode: 403,
        code: 'FORBIDDEN',
        message: 'This action requires admin privileges.',
      });
    }
    if (!roles.includes(user.role)) {
      throw new HttpError({
        statusCode: 403,
        code: 'FORBIDDEN',
        message: `This action requires one of the following roles: ${roles.filter((r) => r !== 'admin').join(', ')}.`,
      });
    }

    next();
  };

export const requireAdminPermission =
  (permission: string): RequestHandler =>
  (req, _res, next) => {
    const user = req.user as {
      id: string;
      email: string;
      role: UserRole;
      isAdmin: boolean;
      adminPermissions?: string[];
      plan: string;
      emailVerified: boolean;
      verified: boolean;
    };

    if (!user) {
      throw new HttpError({
        statusCode: 401,
        code: 'UNAUTHORIZED',
        message: 'Authentication required.',
      });
    }

    if (!user.isAdmin) {
      throw new HttpError({
        statusCode: 403,
        code: 'FORBIDDEN',
        message: 'This action requires admin privileges.',
      });
    }

    // If adminPermissions is undefined or empty, it means full access
    if (!user.adminPermissions || user.adminPermissions.length === 0) {
      return next();
    }

    // Check if they have the specific permission
    if (!user.adminPermissions.includes(permission)) {
      throw new HttpError({
        statusCode: 403,
        code: 'FORBIDDEN',
        message: 'You do not have permission to perform this action.',
      });
    }

    next();
  };

export const requireAdminAnyPermission =
  (...permissions: string[]): RequestHandler =>
  (req, _res, next) => {
    const user = req.user as {
      id: string;
      isAdmin: boolean;
      adminPermissions?: string[];
    };

    if (!user) {
      throw new HttpError({
        statusCode: 401,
        code: 'UNAUTHORIZED',
        message: 'Authentication required.',
      });
    }

    if (!user.isAdmin) {
      throw new HttpError({
        statusCode: 403,
        code: 'FORBIDDEN',
        message: 'This action requires admin privileges.',
      });
    }

    if (!user.adminPermissions || user.adminPermissions.length === 0) {
      return next();
    }

    if (!permissions.some((p) => user.adminPermissions!.includes(p))) {
      throw new HttpError({
        statusCode: 403,
        code: 'FORBIDDEN',
        message: 'You do not have permission to perform this action.',
      });
    }

    next();
  };
