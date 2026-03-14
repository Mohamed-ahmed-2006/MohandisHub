// ---------------------------------------------------------------------------
// Business teams — minimal stub for team accounts (expand with invite/permissions)
// ---------------------------------------------------------------------------

import { Router } from 'express';

import { authenticate } from '../../middleware/authenticate.js';
import { requireEmailVerified } from '../../middleware/require-email-verified.js';
import { requireRole } from '../../middleware/require-role.js';

const router = Router();
router.use(authenticate, requireEmailVerified);

router.get('/me', requireRole('business'), (_req, res) => {
  res.json({ ok: true, data: { team: null, members: [] } });
});

export { router as businessTeamsRouter };
