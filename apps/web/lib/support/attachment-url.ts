import { getApiBaseUrl } from '@/lib/env';

/** Turn upload API paths into absolute URLs when possible; pass through http(s) URLs. */
export function toStoredAttachmentUrl(pathOrUrl: string): string {
  const u = pathOrUrl.trim();
  if (/^https?:\/\//i.test(u)) return u;
  const base = getApiBaseUrl().replace(/\/$/, '');
  if (base) return `${base}${u.startsWith('/') ? u : `/${u}`}`;
  if (typeof window !== 'undefined' && window.location?.origin) {
    return `${window.location.origin}${u.startsWith('/') ? u : `/${u}`}`;
  }
  return u;
}
