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
