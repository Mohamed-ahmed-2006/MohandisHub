import type { RequestHandler } from 'express';

import { logger } from '../config/logger.js';

const PRIVATE_UPLOAD_PATH = /^\/api\/upload\/private\/[^/]+/;

export const redactSensitiveRequestPath = (path: string): string =>
  path.replace(PRIVATE_UPLOAD_PATH, '/api/upload/private/:id');

/**
 * Logs each request after response finishes: method, path, statusCode, requestId, durationMs.
 * Optionally includes userId (opaque id) when authenticated. JSON shape; no PII in logs.
 */
export const requestLoggingMiddleware: RequestHandler = (req, res, next) => {
  const start = Date.now();
  const requestId = typeof res.locals.requestId === 'string' ? res.locals.requestId : undefined;

  res.on('finish', () => {
    const durationMs = Date.now() - start;
    const meta: Record<string, unknown> = {
      method: req.method,
      path: redactSensitiveRequestPath(req.path),
      statusCode: res.statusCode,
      durationMs,
    };
    if (requestId) meta.requestId = requestId;
    const userId = req.user?.id;
    if (userId) meta.userId = userId;

    logger.info('request', meta);
  });

  next();
};
