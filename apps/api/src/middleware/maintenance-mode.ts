// ---------------------------------------------------------------------------
// Maintenance mode middleware — 503 all API routes except status and auth login/refresh
// ---------------------------------------------------------------------------

import type { Request, Response, NextFunction } from 'express';

import { SettingsRepository } from '../modules/settings/settings.repository.js';

const settingsRepo = new SettingsRepository();

function isMaintenanceAllowedPath(path: string, method: string): boolean {
  if (path === '/app/status') return true;
  if (path === '/auth/login' || path === '/auth/refresh' || path === '/auth/forgot-password') {
    return true;
  }
  return path === '/admin/settings' && (method === 'GET' || method === 'PATCH');
}

export async function maintenanceMode(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const path = req.path || req.url?.split('?')[0] || '';
  if (isMaintenanceAllowedPath(path, req.method)) {
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
