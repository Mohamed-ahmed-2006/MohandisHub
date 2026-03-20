import { DEFAULT_COUNTRY_CODE, findCountryByCode } from '@/lib/data/countries';
import { detectCountryLocally } from '@/lib/geo/local-country';

type GeoResult = {
  countryCode: string;
};

let cachedCode: string | null = null;

export const detectCountryByIp = async (): Promise<string> => {
  if (cachedCode) return cachedCode;

  try {
    const code = await Promise.resolve(detectCountryLocally());
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
