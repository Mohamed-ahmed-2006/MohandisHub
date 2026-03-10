import { isApiClientError } from '@/lib/auth/client';

/**
 * Format API error for display. Uses message from API, appends validation details if present.
 */
export function formatApiError(error: unknown, fallback: string): string {
  if (!isApiClientError(error)) return fallback;
  const details = error.details as Record<string, string[] | undefined> | undefined;
  if (!details || typeof details !== 'object') return error.message;
  const parts = Object.entries(details)
    .filter(([, msgs]) => Array.isArray(msgs) && msgs.length > 0)
    .map(([field, msgs]) => `${field}: ${(msgs as string[]).join(', ')}`);
  if (parts.length === 0) return error.message;
  return `${error.message} ${parts.join('; ')}`;
}
