import type { ApiErrorBody } from '@mohandishub/shared';
import type { RequestHandler } from 'express';

export const notFoundHandler: RequestHandler = (req, res) => {
  const requestId = typeof res.locals.requestId === 'string' ? res.locals.requestId : undefined;

  const body: ApiErrorBody = {
    ok: false,
    error: {
      code: 'NOT_FOUND',
      message: `Route not found: ${req.method} ${req.originalUrl}`,
      ...(requestId ? { requestId } : {}),
    },
  };

  res.status(404).json(body);
};
