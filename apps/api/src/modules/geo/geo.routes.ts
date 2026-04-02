// ---------------------------------------------------------------------------
// Geo routes — server-side country lookup
// ---------------------------------------------------------------------------

import { Router } from 'express';

import { geoController } from './geo.controller.js';

const geoRouter = Router();

geoRouter.get('/country', geoController.getCountryFromIp);

export { geoRouter };

