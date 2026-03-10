/**
 * Fetch user's country code from IP using ipapi.co (free, no key required).
 * Returns 2-letter ISO code (e.g. "EG") or null on failure.
 */
export async function getCountryFromIp(): Promise<string | null> {
  try {
    const res = await fetch('https://ipapi.co/json/', { signal: AbortSignal.timeout(5000) });
    if (!res.ok) return null;
    const data = (await res.json()) as { country_code?: string };
    return typeof data.country_code === 'string' ? data.country_code.toUpperCase() : null;
  } catch {
    return null;
  }
}
