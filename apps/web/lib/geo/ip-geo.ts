import { detectCountryLocally } from '@/lib/geo/local-country';

export async function getCountryFromIp(): Promise<string | null> {
  try {
    return await Promise.resolve(detectCountryLocally());
  } catch {
    return null;
  }
}
