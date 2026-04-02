import { DEFAULT_COUNTRY_CODE, findCountryByCode } from '@/lib/data/countries';
import { getApiBaseUrl } from '@/lib/env';
import { detectCountryLocally } from '@/lib/geo/local-country';

type GeoResult = {
  countryCode: string;
};

let cachedCode: string | null = null;

export const detectCountryByIp = async (): Promise<string> => {
  if (cachedCode) return cachedCode;

  try {
    const apiBase = getApiBaseUrl();
    let code: string | null = null;

    if (apiBase) {
      const res = await fetch(`${apiBase}/api/geo/country`, { credentials: 'include' });
      if (res.ok) {
        const json: unknown = await res.json().catch(() => null);
        const data = json && typeof json === 'object' ? (json as { data?: unknown }).data : null;
        code = typeof data === 'string' ? data.toUpperCase() : null;
      }
    }

    if (!code) code = await Promise.resolve(detectCountryLocally());

    const match = code ? findCountryByCode(code) : undefined;
    cachedCode = match ? code : DEFAULT_COUNTRY_CODE;
    return cachedCode;
  } catch {
    return DEFAULT_COUNTRY_CODE;
  }
};

export const getDetectedCountry = (): GeoResult => ({
  countryCode: cachedCode ?? DEFAULT_COUNTRY_CODE,
});
