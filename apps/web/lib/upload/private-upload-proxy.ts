const PRIVATE_UPLOAD_PREFIX = '/api/upload/private/';

const normalizeApiBase = (apiBase: string): string => {
  const trimmed = apiBase.trim().replace(/\/+$/, '');
  // Some configs accidentally include `/api` in the base URL.
  return trimmed.endsWith('/api') ? trimmed.slice(0, -'/api'.length) : trimmed;
};

/**
 * Resolve the single upstream URL to fetch. The host is ALWAYS our configured
 * API base — never an origin derived from client input. Absolute URLs are
 * accepted only to extract their pathname/search; their origin is discarded.
 * This prevents SSRF and forwarding the caller's Authorization header to an
 * attacker-controlled host.
 */
export const toPrivateUploadUpstreamUrl = (
  rawPath: string | null,
  apiBase: string,
): string | null => {
  if (!rawPath) return null;
  const trimmed = rawPath.trim();
  if (!trimmed) return null;

  const normalizedApiBase = normalizeApiBase(apiBase);
  if (!normalizedApiBase) return null;

  // Derive a relative path (must contain the private-upload prefix) from the input,
  // regardless of whether the caller passed an absolute URL, a scheme-less host,
  // a relative path, or a bare upload id.
  let relativePath: string | null = null;

  if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
    try {
      const parsed = new URL(trimmed);
      if (!parsed.pathname?.includes(PRIVATE_UPLOAD_PREFIX)) return null;
      // Discard parsed.origin entirely; only the pathname/search are trusted.
      relativePath = `${parsed.pathname}${parsed.search}`;
    } catch {
      return null;
    }
  } else if (trimmed.startsWith('/')) {
    if (!trimmed.includes(PRIVATE_UPLOAD_PREFIX)) return null;
    relativePath = trimmed;
  } else if (trimmed.includes(PRIVATE_UPLOAD_PREFIX)) {
    // Scheme-less host, e.g. `api.mohandishub.app/api/upload/private/<id>`.
    const idx = trimmed.indexOf(PRIVATE_UPLOAD_PREFIX);
    relativePath = trimmed.slice(idx);
  } else {
    // Assume caller passed a bare upload id (uuid-like).
    relativePath = `${PRIVATE_UPLOAD_PREFIX}${trimmed.replace(/^\/+/, '')}`;
  }

  if (!relativePath || !relativePath.startsWith('/')) return null;
  return `${normalizedApiBase}${relativePath}`;
};
