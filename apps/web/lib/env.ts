/**
 * NEXT_PUBLIC_API_URL must be an absolute URL for browser `fetch` and for the
 * private-upload proxy's server-side `fetch`. Values like `api.example.com`
 * (no scheme) are treated as relative paths in the browser and break uploads
 * and admin previews — normalize them here.
 */
const withDefaultScheme = (trimmed: string): string => {
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  const hostPart = trimmed.split('/')[0] ?? trimmed;
  const isLocal =
    /^(localhost|127\.0\.0\.1)(:\d+)?$/i.test(hostPart) || /^\[::1\](:\d+)?$/i.test(hostPart);
  return `${isLocal ? 'http' : 'https'}://${trimmed.replace(/^\/+/, '')}`;
};

export const getApiBaseUrl = (): string => {
  const value = process.env.NEXT_PUBLIC_API_URL;

  if (value && value.trim().length > 0) {
    return withDefaultScheme(value.trim());
  }

  return '';
};

/**
 * Base URL for cookie-based auth (login / refresh / logout). When
 * `NEXT_PUBLIC_AUTH_SAME_ORIGIN=1` in the browser, returns `''` so requests hit
 * `/api/auth/*` on the Next host — rewrites must forward to the real API via
 * `API_INTERNAL_URL`. Use this for localhost dev against a remote API so Chrome
 * still stores and sends the refresh cookie (cross-site api host is blocked).
 */
export const getAuthApiBaseUrl = (): string => {
  const sameOriginAuth =
    process.env.NEXT_PUBLIC_AUTH_SAME_ORIGIN === '1' ||
    process.env.NEXT_PUBLIC_AUTH_SAME_ORIGIN === 'true';
  if (typeof window !== 'undefined' && sameOriginAuth) {
    return '';
  }
  return getApiBaseUrl();
};
