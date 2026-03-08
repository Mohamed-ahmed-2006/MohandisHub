// ---------------------------------------------------------------------------
// App routes — public app status (no auth)
// ---------------------------------------------------------------------------

import type { ApiSuccessBody } from '@mohandishub/shared';
import { Router } from 'express';

import { asyncHandler } from '../../utils/async-handler.js';

import { SettingsService } from '../settings/settings.service.js';

const settingsService = new SettingsService();

const appRouter = Router();

appRouter.get(
  '/status',
  asyncHandler(async (_req, res) => {
    const status = await settingsService.getAppStatus();
    const response: ApiSuccessBody<typeof status> = { ok: true, data: status };
    res.json(response);
  }),
);

export { appRouter };
