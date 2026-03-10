import { findCountryByCode } from './countries';

/**
 * Cities by country code. Used for city select; country is derived from selected city.
 */
export type CityEntry = {
  code: string;
  nameEn: string;
  nameAr: string;
  countryCode: string;
};

export const CITIES: CityEntry[] = [
  // Egypt
  { code: 'cairo', nameEn: 'Cairo', nameAr: 'القاهرة', countryCode: 'EG' },
  { code: 'alexandria', nameEn: 'Alexandria', nameAr: 'الإسكندرية', countryCode: 'EG' },
  { code: 'giza', nameEn: 'Giza', nameAr: 'الجيزة', countryCode: 'EG' },
  { code: 'sharm', nameEn: 'Sharm El-Sheikh', nameAr: 'شرم الشيخ', countryCode: 'EG' },
  { code: 'luxor', nameEn: 'Luxor', nameAr: 'الأقصر', countryCode: 'EG' },
  { code: 'aswan', nameEn: 'Aswan', nameAr: 'أسوان', countryCode: 'EG' },
  { code: 'port-said', nameEn: 'Port Said', nameAr: 'بورسعيد', countryCode: 'EG' },
  { code: 'suez', nameEn: 'Suez', nameAr: 'السويس', countryCode: 'EG' },
  { code: 'mansoura', nameEn: 'Mansoura', nameAr: 'المنصورة', countryCode: 'EG' },
  { code: 'tanta', nameEn: 'Tanta', nameAr: 'طنطا', countryCode: 'EG' },
  // Saudi Arabia
  { code: 'riyadh', nameEn: 'Riyadh', nameAr: 'الرياض', countryCode: 'SA' },
  { code: 'jeddah', nameEn: 'Jeddah', nameAr: 'جدة', countryCode: 'SA' },
  { code: 'makkah', nameEn: 'Makkah', nameAr: 'مكة المكرمة', countryCode: 'SA' },
  { code: 'madinah', nameEn: 'Madinah', nameAr: 'المدينة المنورة', countryCode: 'SA' },
  { code: 'dammam', nameEn: 'Dammam', nameAr: 'الدمام', countryCode: 'SA' },
  { code: 'khobar', nameEn: 'Khobar', nameAr: 'الخبر', countryCode: 'SA' },
  { code: 'taif', nameEn: 'Taif', nameAr: 'الطائف', countryCode: 'SA' },
  // UAE
  { code: 'dubai', nameEn: 'Dubai', nameAr: 'دبي', countryCode: 'AE' },
  { code: 'abu-dhabi', nameEn: 'Abu Dhabi', nameAr: 'أبوظبي', countryCode: 'AE' },
  { code: 'sharjah', nameEn: 'Sharjah', nameAr: 'الشارقة', countryCode: 'AE' },
  { code: 'ajman', nameEn: 'Ajman', nameAr: 'عجمان', countryCode: 'AE' },
  { code: 'ras-al-khaimah', nameEn: 'Ras Al Khaimah', nameAr: 'رأس الخيمة', countryCode: 'AE' },
  { code: 'fujairah', nameEn: 'Fujairah', nameAr: 'الفجيرة', countryCode: 'AE' },
  // Kuwait
  { code: 'kuwait-city', nameEn: 'Kuwait City', nameAr: 'مدينة الكويت', countryCode: 'KW' },
  { code: 'hawalli', nameEn: 'Hawalli', nameAr: 'حولي', countryCode: 'KW' },
  { code: 'ahmadi', nameEn: 'Ahmadi', nameAr: 'الأحمدي', countryCode: 'KW' },
  // Qatar
  { code: 'doha', nameEn: 'Doha', nameAr: 'الدوحة', countryCode: 'QA' },
  { code: 'al-rayyan', nameEn: 'Al Rayyan', nameAr: 'الريان', countryCode: 'QA' },
  // Bahrain
  { code: 'manama', nameEn: 'Manama', nameAr: 'المنامة', countryCode: 'BH' },
  { code: 'muharraq', nameEn: 'Muharraq', nameAr: 'المحرق', countryCode: 'BH' },
  // Oman
  { code: 'muscat', nameEn: 'Muscat', nameAr: 'مسقط', countryCode: 'OM' },
  { code: 'salalah', nameEn: 'Salalah', nameAr: 'صلالة', countryCode: 'OM' },
  // Jordan
  { code: 'amman', nameEn: 'Amman', nameAr: 'عمان', countryCode: 'JO' },
  { code: 'zarqa', nameEn: 'Zarqa', nameAr: 'الزرقاء', countryCode: 'JO' },
  { code: 'irbid', nameEn: 'Irbid', nameAr: 'إربد', countryCode: 'JO' },
  // Lebanon
  { code: 'beirut', nameEn: 'Beirut', nameAr: 'بيروت', countryCode: 'LB' },
  { code: 'tripoli', nameEn: 'Tripoli', nameAr: 'طرابلس', countryCode: 'LB' },
  // Iraq
  { code: 'baghdad', nameEn: 'Baghdad', nameAr: 'بغداد', countryCode: 'IQ' },
  { code: 'basra', nameEn: 'Basra', nameAr: 'البصرة', countryCode: 'IQ' },
  { code: 'erbil', nameEn: 'Erbil', nameAr: 'أربيل', countryCode: 'IQ' },
  // Other countries - major cities
  { code: 'new-york', nameEn: 'New York', nameAr: 'نيويورك', countryCode: 'US' },
  { code: 'los-angeles', nameEn: 'Los Angeles', nameAr: 'لوس أنجلوس', countryCode: 'US' },
  { code: 'london', nameEn: 'London', nameAr: 'لندن', countryCode: 'GB' },
  { code: 'manchester', nameEn: 'Manchester', nameAr: 'مانشستر', countryCode: 'GB' },
  { code: 'toronto', nameEn: 'Toronto', nameAr: 'تورونتو', countryCode: 'CA' },
  { code: 'berlin', nameEn: 'Berlin', nameAr: 'برلين', countryCode: 'DE' },
  { code: 'munich', nameEn: 'Munich', nameAr: 'ميونخ', countryCode: 'DE' },
  { code: 'paris', nameEn: 'Paris', nameAr: 'باريس', countryCode: 'FR' },
  { code: 'istanbul', nameEn: 'Istanbul', nameAr: 'إسطنبول', countryCode: 'TR' },
  { code: 'ankara', nameEn: 'Ankara', nameAr: 'أنقرة', countryCode: 'TR' },
];

export const getCitiesByCountry = (countryCode: string): CityEntry[] =>
  CITIES.filter((c) => c.countryCode === countryCode);

export const getCityByCode = (code: string): CityEntry | undefined =>
  CITIES.find((c) => c.code === code);

export const getCountryCodeForCity = (cityCode: string): string | undefined =>
  getCityByCode(cityCode)?.countryCode;

/** Get city and country display names from city code (for form submission). */
export function getCityAndCountryFromCode(
  cityCode: string,
  locale: 'ar' | 'en',
): { city: string; country: string } | null {
  const city = getCityByCode(cityCode);
  if (!city) return null;
  const country = findCountryByCode(city.countryCode);
  if (!country) return null;
  const key = locale === 'ar' ? 'nameAr' : 'nameEn';
  return { city: city[key], country: country[key] };
}
