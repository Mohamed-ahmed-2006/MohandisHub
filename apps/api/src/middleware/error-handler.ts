import type { ApiErrorBody } from '@mohandishub/shared';
import type { ErrorRequestHandler } from 'express';

import { env } from '../config/env.js';
import { logger } from '../config/logger.js';
import { HttpError } from '../utils/http-error.js';

export const errorHandler: ErrorRequestHandler = (error, req, res, next) => {
  void next;
  void req;
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

  const pgLikeError = error as { code?: string; message?: string };
  const isReservationSchemaError =
    pgLikeError.code === '42P01' &&
    typeof pgLikeError.message === 'string' &&
    (pgLikeError.message.includes('reservations') ||
      pgLikeError.message.includes('reservation_slots') ||
      pgLikeError.message.includes('reservation_'));
  if (isReservationSchemaError) {
    const body: ApiErrorBody = {
      ok: false,
      error: {
        code: 'SCHEMA_OUTDATED',
        message:
          'Reservation schema is missing in database. Run migrations (`npx supabase db push`) and restart API.',
        ...(requestId ? { requestId } : {}),
      },
    };
    res.status(503).json(body);
    return;
  }

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
