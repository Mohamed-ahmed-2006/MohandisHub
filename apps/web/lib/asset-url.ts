import { getApiBaseUrl } from '@/lib/env';

/** Stored URLs often point here; rewrite to your configured API host. */
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

  // Rewrite localhost / 127.0.0.1 uploads to your configured API host.
  // This covers:
  // - `http://localhost:4000/uploads/...`
  // - `https://127.0.0.1:4000/uploads/...`
  // - `//localhost:4000/uploads/...` (scheme-less URLs sometimes stored by backends)
  if (LOCAL_API_HOST_RE.test(trimmed) || trimmed.startsWith('//')) {
    try {
      const parsed =
        trimmed.startsWith('//') ? new URL(`http:${trimmed}`) : new URL(trimmed);
      const isLocal = parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1';
      if (!isLocal) return trimmed;

      const rewritten = base ? `${base}${parsed.pathname}${parsed.search}${parsed.hash}` : trimmed;

      return rewritten;
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
