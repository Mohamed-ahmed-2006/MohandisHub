import * as Sentry from '@sentry/node';

import { env } from './env.js';

export function initSentry(): void {
  if (!env.SENTRY_DSN) return;
  Sentry.init({
    dsn: env.SENTRY_DSN,
    environment: env.NODE_ENV,
    tracesSampleRate: env.NODE_ENV === 'production' ? 0.1 : 1,
  });
}

export function captureException(
  error: unknown,
  context?: { requestId?: string | undefined; userId?: string | undefined },
): void {
  if (!env.SENTRY_DSN) return;
  Sentry.withScope((scope) => {
    if (context?.requestId !== undefined && context.requestId !== '')
      scope.setTag('requestId', context.requestId);
    if (context?.userId !== undefined && context.userId !== '')
      scope.setTag('userId', context.userId);
    Sentry.captureException(error);
  });
}
