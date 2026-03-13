import { isApiClientError } from '@/lib/auth/client';
import type { Dictionary } from '@/lib/i18n/types';

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

/**
 * Format API error with optional dictionary for translated messages.
 * Maps known codes (e.g. HTTP_ERROR for network issues) to dictionary.auth.errors.
 */
export function formatApiErrorWithDictionary(
  error: unknown,
  fallback: string,
  dictionary?: Dictionary,
): string {
  const base = formatApiError(error, fallback);
  if (!dictionary?.auth?.errors || !isApiClientError(error)) return base;
  const { code } = error;
  if (code === 'HTTP_ERROR' || code === 'NETWORK_ERROR' || code === 'FETCH_ERROR') {
    return dictionary.auth.errors.networkError;
  }
  return base;
}
