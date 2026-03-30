// ---------------------------------------------------------------------------
// Maintenance mode middleware — 503 all API routes except status and auth login/refresh
// ---------------------------------------------------------------------------

import type { Request, Response, NextFunction } from 'express';

import { SettingsRepository } from '../modules/settings/settings.repository.js';

const settingsRepo = new SettingsRepository();

const ALLOWED_PATHS = ['/app/status', '/auth/login', '/auth/refresh', '/auth/forgot-password', '/admin', '/notifications'];

export async function maintenanceMode(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const path = req.path || req.url?.split('?')[0] || '';
  const allowed = ALLOWED_PATHS.some((p) => path === p || path.startsWith(p + '/') || path.startsWith(p));
  if (allowed) {
    return next();
  }

  const row = await settingsRepo.get();
  if (row?.maintenance_mode) {
    res.status(503).json({
      ok: false,
      error: {
        code: 'MAINTENANCE_MODE',
        message: row.maintenance_message ?? 'The app is under maintenance. Please try again later.',
      },
    });
    return;
  }

  next();
}
