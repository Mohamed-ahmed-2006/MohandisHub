import type { ApiErrorBody } from '@mohandishub/shared';
import type { ErrorRequestHandler } from 'express';
import { ZodError } from 'zod';

import { env } from '../config/env.js';
import { logger } from '../config/logger.js';
import { captureException } from '../config/sentry.js';
import { HttpError } from '../utils/http-error.js';

export const errorHandler: ErrorRequestHandler = (error, req, res, next) => {
  void next;
  void req;
  const requestId = typeof res.locals.requestId === 'string' ? res.locals.requestId : undefined;

  if (error instanceof ZodError) {
    const flattened = error.flatten();
    const fieldErrors = flattened.fieldErrors as Record<string, string[] | undefined>;
    const message =
      Object.values(fieldErrors)
        .flat()
        .filter(Boolean)[0] ?? 'Validation failed';
    const body: ApiErrorBody = {
      ok: false,
      error: {
        code: 'VALIDATION_ERROR',
        message,
        details: fieldErrors,
        ...(requestId ? { requestId } : {}),
      },
    };
    res.status(400).json(body);
    return;
  }

  if (error instanceof HttpError) {
    if (error.statusCode >= 500) {
      captureException(error, {
        ...(requestId && { requestId }),
        ...(req.user?.id && { userId: req.user.id }),
      });
    }
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

  // Well-known wallet errors thrown as plain Errors from the repository layer
  // (e.g. spending from a frozen wallet). Map to a clean client status before
  // the generic unhandled-error logging/Sentry path to avoid noise.
  if (error instanceof Error && error.message === 'WALLET_FROZEN') {
    const body: ApiErrorBody = {
      ok: false,
      error: {
        code: 'WALLET_FROZEN',
        message: 'This wallet is frozen. Please contact support.',
        ...(requestId ? { requestId } : {}),
      },
    };
    res.status(403).json(body);
    return;
  }

  logger.error('Unhandled error', {
    requestId,
    error: error instanceof Error ? error.message : 'Unknown error',
    ...(error instanceof Error && error.stack ? { stack: error.stack } : {}),
  });
  captureException(error, {
    ...(requestId && { requestId }),
    ...(req.user?.id && { userId: req.user.id }),
  });

  const pgLikeError = error as { code?: string; message?: string };
  const pgMessage = typeof pgLikeError.message === 'string' ? pgLikeError.message : '';
  const isReservationSchemaError =
    pgLikeError.code === '42P01' &&
    (pgMessage.includes('reservations') ||
      pgMessage.includes('reservation_slots') ||
      pgMessage.includes('reservation_'));
  if (isReservationSchemaError) {
    const body: ApiErrorBody = {
      ok: false,
      error: {
        code: 'SCHEMA_OUTDATED',
        message:
          'Reservation schema is missing in database. Run migrations (`supabase db push`) and restart API.',
        ...(requestId ? { requestId } : {}),
      },
    };
    res.status(503).json(body);
    return;
  }

  const isNotificationsSchemaError =
    pgLikeError.code === '42P01' && pgMessage.includes('notifications');
  if (isNotificationsSchemaError) {
    const body: ApiErrorBody = {
      ok: false,
      error: {
        code: 'SCHEMA_OUTDATED',
        message:
          'Notifications table is missing. Run migrations (e.g. `supabase db push` or apply 20260313000001_notifications.sql) and restart API.',
        ...(requestId ? { requestId } : {}),
      },
    };
    res.status(503).json(body);
    return;
  }

  captureException(error, {
    ...(requestId && { requestId }),
    ...(req.user?.id && { userId: req.user.id }),
  });

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
