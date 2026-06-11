import type { RequestHandler } from 'express';

import { getAllowedCorsOrigins } from '../config/cors.js';
import { env } from '../config/env.js';
import { HttpError } from '../utils/http-error.js';

function originFromReferer(referer: string | undefined): string | null {
  if (!referer) return null;
  try {
    return new URL(referer).origin;
  } catch {
    return null;
  }
}

export const requireTrustedAuthOrigin: RequestHandler = (req, _res, next) => {
  const origin = req.get('origin') ?? originFromReferer(req.get('referer')) ?? null;
  const allowed = getAllowedCorsOrigins();

  if (env.NODE_ENV === 'production' && !origin) {
    throw new HttpError({
      statusCode: 403,
      code: 'UNTRUSTED_ORIGIN',
      message: 'Trusted origin is required for this auth action.',
    });
  }

  if (origin && !allowed.includes(origin)) {
    throw new HttpError({
      statusCode: 403,
      code: 'UNTRUSTED_ORIGIN',
      message: 'Origin is not allowed for this auth action.',
    });
  }

  next();
};
