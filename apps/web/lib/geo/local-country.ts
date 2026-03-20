import { DEFAULT_COUNTRY_CODE, findCountryByCode } from '@/lib/data/countries';

const timezoneCountryMap: Record<string, string> = {
  'Africa/Cairo': 'EG',
  'Africa/Casablanca': 'MA',
  'Africa/Algiers': 'DZ',
  'Africa/Tunis': 'TN',
  'Africa/Tripoli': 'LY',
  'Asia/Riyadh': 'SA',
  'Asia/Dubai': 'AE',
  'Asia/Kuwait': 'KW',
  'Asia/Qatar': 'QA',
  'Asia/Bahrain': 'BH',
  'Asia/Muscat': 'OM',
  'Asia/Amman': 'JO',
  'Asia/Beirut': 'LB',
  'Asia/Baghdad': 'IQ',
  'Asia/Damascus': 'SY',
  'Asia/Gaza': 'PS',
  'Asia/Jerusalem': 'PS',
  'Asia/Aden': 'YE',
  'Europe/London': 'GB',
  'Europe/Berlin': 'DE',
  'Europe/Paris': 'FR',
  'Europe/Rome': 'IT',
  'Europe/Madrid': 'ES',
  'America/New_York': 'US',
  'America/Chicago': 'US',
  'America/Denver': 'US',
  'America/Los_Angeles': 'US',
  'America/Toronto': 'CA',
  'Asia/Kolkata': 'IN',
  'Asia/Karachi': 'PK',
  'Asia/Dhaka': 'BD',
  'Asia/Shanghai': 'CN',
  'Asia/Tokyo': 'JP',
  'Asia/Seoul': 'KR',
  'Asia/Kuala_Lumpur': 'MY',
  'Asia/Jakarta': 'ID',
  'Asia/Manila': 'PH',
  'Asia/Singapore': 'SG',
  'Australia/Sydney': 'AU',
  'Pacific/Auckland': 'NZ',
};

function normalizeCountryCode(value: string | null | undefined): string | null {
  if (!value) return null;
  const code = value.trim().toUpperCase();
  return findCountryByCode(code) ? code : null;
}

function getCountryFromLanguages(): string | null {
  if (typeof navigator === 'undefined') return null;

  const candidates = navigator.languages?.length ? navigator.languages : [navigator.language];

  for (const language of candidates) {
    if (!language) continue;

    const parts = language.split('-');
    const region = parts.at(-1);
    const normalized = normalizeCountryCode(region);

    if (normalized) return normalized;
  }

  return null;
}

function getCountryFromTimezone(): string | null {
  if (typeof Intl === 'undefined') return null;

  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  return normalizeCountryCode(timezoneCountryMap[timeZone]);
}

export function detectCountryLocally(): string {
  return getCountryFromLanguages() ?? getCountryFromTimezone() ?? DEFAULT_COUNTRY_CODE;
}
