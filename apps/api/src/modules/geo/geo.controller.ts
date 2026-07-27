// ---------------------------------------------------------------------------
// Geo controller — server-side IP -> country lookup
// ---------------------------------------------------------------------------

import { fetchWithTimeout } from '../../lib/fetch-with-timeout.js';
import { asyncHandler } from '../../utils/async-handler.js';

const FALLBACK_COUNTRY_CODE = 'EG';

function normalizeClientIp(raw: string | string[] | undefined): string | null {
  if (!raw) return null;

  const value = Array.isArray(raw) ? raw[0] : raw;
  if (!value) return null;
  const first = value.split(',').at(0)?.trim();
  if (!first) return null;

  // Express might provide IPv6-mapped IPv4 like `::ffff:1.2.3.4`
  const withoutPrefix = first.startsWith('::ffff:') ? first.slice('::ffff:'.length) : first;
  if (withoutPrefix === '::1') return null;

  return withoutPrefix;
}

export const geoController = {
  getCountryFromIp: asyncHandler(async (req, res) => {
    const xff = req.headers['x-forwarded-for'];
    const clientIp = normalizeClientIp(xff ?? req.ip);

    // If we can't determine IP (rare), return fallback to keep UI working.
    if (!clientIp) {
      res.json({ ok: true, data: FALLBACK_COUNTRY_CODE });
      return;
    }

    // ipapi.co doesn't require an API key for a basic JSON response.
    // We use the provided IP to avoid returning the server's own IP.
    try {
      const response = await fetchWithTimeout(
        `https://ipapi.co/${encodeURIComponent(clientIp)}/json/`,
        { headers: { Accept: 'application/json' } },
        { timeoutMs: 2_000, retries: 1 },
      );

      if (!response.ok) {
        res.json({ ok: true, data: FALLBACK_COUNTRY_CODE });
        return;
      }

      const body: unknown = await response.json().catch(() => null);
      const maybe = body as { country_code?: unknown } | null;
      const rawCode = typeof maybe?.country_code === 'string' ? maybe.country_code : null;
      const countryCode = rawCode && /^[a-zA-Z]{2}$/.test(rawCode) ? rawCode.toUpperCase() : null;

      res.json({ ok: true, data: countryCode ?? FALLBACK_COUNTRY_CODE });
    } catch {
      res.json({ ok: true, data: FALLBACK_COUNTRY_CODE });
    }
  }),
};
