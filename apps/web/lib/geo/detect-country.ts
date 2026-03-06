import { DEFAULT_COUNTRY_CODE, findCountryByCode } from '@/lib/data/countries';

type GeoResult = {
  countryCode: string;
};

let cachedCode: string | null = null;

export const detectCountryByIp = async (): Promise<string> => {
  if (cachedCode) return cachedCode;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 4000);

    const response = await fetch('https://ipapi.co/json/', {
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (!response.ok) return DEFAULT_COUNTRY_CODE;

    const data = (await response.json()) as { country_code?: string };
    const code = data.country_code?.toUpperCase() ?? DEFAULT_COUNTRY_CODE;

    const match = findCountryByCode(code);
    cachedCode = match ? code : DEFAULT_COUNTRY_CODE;
    return cachedCode;
  } catch {
    return DEFAULT_COUNTRY_CODE;
  }
};

export const getDetectedCountry = (): GeoResult => ({
  countryCode: cachedCode ?? DEFAULT_COUNTRY_CODE,
});
