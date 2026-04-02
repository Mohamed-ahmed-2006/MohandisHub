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
      // Runtime evidence for this bug (visible in devtools).
      console.warn('[asset-url] rewrite local upload', { input: trimmed, apiBaseUrl: base, output: rewritten });

      // #region agent log
      fetch('http://127.0.0.1:7325/ingest/ebd08bf8-7d73-450c-ad4d-4436a6c2225b', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Debug-Session-Id': 'b33485',
        },
        body: JSON.stringify({
          sessionId: 'b33485',
          runId: 'post-fix',
          hypothesisId: 'H_localhost_rewrite_scheme_less_handled',
          location: 'asset-url.ts:resolvePublicAssetUrl:rewrite',
          message: 'Rewriting local upload URL to API host (incl. scheme-less)',
          data: {
            apiBaseUrlPresent: Boolean(base),
            input: trimmed.slice(0, 120),
            rewritten: rewritten.slice(0, 120),
          },
          timestamp: Date.now(),
        }),
      }).catch(() => {});
      // #endregion

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
