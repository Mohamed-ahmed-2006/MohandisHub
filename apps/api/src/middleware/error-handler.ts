import type { ApiErrorBody } from '@mohandishub/shared';
import type { ErrorRequestHandler } from 'express';

import { env } from '../config/env.js';
import { logger } from '../config/logger.js';
import { HttpError } from '../utils/http-error.js';

export const errorHandler: ErrorRequestHandler = (error, _req, res, next) => {
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
  });

  const body: ApiErrorBody = {
    ok: false,
    error: {
      code: 'INTERNAL_SERVER_ERROR',
      message:
        env.NODE_ENV === 'production' ? 'An unexpected error occurred' : 'Unhandled exception',
      ...(requestId ? { requestId } : {}),
    },
  };

  res.status(500).json(body);
};
