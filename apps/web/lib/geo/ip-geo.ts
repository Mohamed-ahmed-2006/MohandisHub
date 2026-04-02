import { getApiBaseUrl } from '@/lib/env';
import { detectCountryLocally } from '@/lib/geo/local-country';

export async function getCountryFromIp(): Promise<string | null> {
  try {
    const apiBase = getApiBaseUrl();
    if (!apiBase) return detectCountryLocally();

    const res = await fetch(`${apiBase}/api/geo/country`, { credentials: 'include' });
    if (!res.ok) throw new Error(`Geo request failed (${res.status})`);

    const json: unknown = await res.json().catch(() => null);
    const data = json && typeof json === 'object' ? (json as { data?: unknown }).data : null;
    const code = typeof data === 'string' ? data.toUpperCase() : null;

    if (code && /^[A-Z]{2}$/.test(code)) return code;
  } catch {
    // Fall back to client-side detection when backend geo lookup fails.
    try {
      return detectCountryLocally();
    } catch {
      return null;
    }
  }

  return null;
}
