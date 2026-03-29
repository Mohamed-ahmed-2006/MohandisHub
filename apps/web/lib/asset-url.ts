import { getApiBaseUrl } from '@/lib/env';

/** Stored URLs from dev often point here; production must use the real API host. */
const LOCAL_API_HOST_RE = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?/i;

/**
 * Resolve avatar / public upload URLs for the browser or `next/image`.
 * Rewrites `http://localhost:4000/uploads/...` (and similar) to `NEXT_PUBLIC_API_URL` + path
 * so production optimizers can fetch the file from your deployed API.
 */
export function resolvePublicAssetUrl(url: string | null | undefined): string | null {
  if (url == null) return null;
  const trimmed = String(url).trim();
  if (trimmed === '') return null;
  if (trimmed.startsWith('blob:') || trimmed.startsWith('data:')) return trimmed;

  const base = (getApiBaseUrl() || '').replace(/\/$/, '');

  if (LOCAL_API_HOST_RE.test(trimmed)) {
    try {
      const parsed = new URL(trimmed);
      return base ? `${base}${parsed.pathname}${parsed.search}${parsed.hash}` : trimmed;
    } catch {
      return trimmed;
    }
  }

  if (trimmed.startsWith('/')) {
    return base ? `${base}${trimmed}` : trimmed;
  }

  return trimmed;
}

/** Same as resolvePublicAssetUrl but never null (for call sites that require a string). */
export function toAbsoluteAssetUrl(url: string): string {
  return resolvePublicAssetUrl(url) ?? url;
}
