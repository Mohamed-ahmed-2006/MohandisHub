import path from 'node:path';
import { appendFileSync } from 'node:fs';

import type { ApiErrorBody } from '@mohandishub/shared';
import type { ErrorRequestHandler } from 'express';

import { env } from '../config/env.js';
import { logger } from '../config/logger.js';
import { HttpError } from '../utils/http-error.js';

export const errorHandler: ErrorRequestHandler = (error, req, res, next) => {
  void next;
  const requestId = typeof res.locals.requestId === 'string' ? res.locals.requestId : undefined;

  if (error instanceof HttpError) {
    const body: ApiErrorBody = {
      ok: false,
      error: {
        code: error.code,
        message: error.message,
        ...(error.details ? { details: error.details } : {}),
        ...(requestId ? { requestId } : {}),
      },
    };

    res.status(error.statusCode).json(body);
    return;
  }

  logger.error('Unhandled error', {
    requestId,
    error: error instanceof Error ? error.message : 'Unknown error',
    ...(error instanceof Error && error.stack ? { stack: error.stack } : {}),
  });

  // #region agent log
  const errData = {
    sessionId: '8fd58e',
    location: 'error-handler.ts:500',
    message: 'Unhandled error leading to 500',
    data: {
      errorMessage: error instanceof Error ? error.message : String(error),
      errorName: error instanceof Error ? error.name : undefined,
      path: req?.path ?? req?.url,
      isForgotPassword: req?.path?.includes('forgot-password') ?? false,
    },
    timestamp: Date.now(),
    hypothesisId: 'H1,H2,H3,H4,H5',
  };
  fetch('http://127.0.0.1:7325/ingest/ebd08bf8-7d73-450c-ad4d-4436a6c2225b', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Debug-Session-Id': '8fd58e' },
    body: JSON.stringify(errData),
  }).catch(() => {});
  try {
    const logPath = path.resolve(process.cwd(), 'debug-8fd58e.log');
    appendFileSync(logPath, JSON.stringify(errData) + '\n');
  } catch {
    try {
      appendFileSync(path.resolve(process.cwd(), '..', '..', 'debug-8fd58e.log'), JSON.stringify(errData) + '\n');
    } catch {}
  }
  // #endregion

  const body: ApiErrorBody = {
    ok: false,
    error: {
      code: 'INTERNAL_SERVER_ERROR',
      message:
        env.NODE_ENV === 'production'
          ? 'An unexpected error occurred'
          : error instanceof Error
            ? error.message
            : 'Unhandled exception',
      ...(requestId ? { requestId } : {}),
    },
  };

  res.status(500).json(body);
};
