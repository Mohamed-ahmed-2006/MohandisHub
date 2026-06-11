/**
 * Universities by country code (alpha-2).
 * Source: Hipo university-domains-list (world_universities_and_domains.json)
 * Arabic names added for major institutions in Arab countries.
 */
import { COUNTRIES } from './countries';
import universitiesByCountry from './universities-by-country.json';

/** Arabic name mapping for major universities (English name -> Arabic name) */
const UNIVERSITY_AR: Record<string, string> = {
  // Egypt
  'Cairo University': 'جامعة القاهرة',
  'Ain Shams University': 'جامعة عين شمس',
  'Alexandria University': 'جامعة الإسكندرية',
  'Al Azhar University': 'جامعة الأزهر',
  'American University in Cairo': 'الجامعة الأمريكية بالقاهرة',
  'Helwan University': 'جامعة حلوان',
  'Mansoura University': 'جامعة المنصورة',
  'Assiut University': 'جامعة أسيوط',
  'Tanta University': 'جامعة طنطا',
  'Zagazig University': 'جامعة الزقازيق',
  'Suez Canal University': 'جامعة قناة السويس',
  'German University in Cairo': 'الجامعة الألمانية بالقاهرة',
  'Nile University': 'جامعة النيل',
  'Arab Academy for Science & Technology': 'الأكاديمية العربية للعلوم والتكنولوجيا',
  // Saudi Arabia
  'King Saud University': 'جامعة الملك سعود',
  'King Abdulaziz University': 'جامعة الملك عبد العزيز',
  'King Fahd University of Petroleum and Minerals': 'جامعة الملك فهد للبترول والمعادن',
  'King Abdullah University of Science and Technology': 'جامعة الملك عبد الله للعلوم والتقنية',
  'Umm Al-Qura University': 'جامعة أم القرى',
  'Islamic University of Medinah': 'الجامعة الإسلامية بالمدينة المنورة',
  'Imam Abdulrahman Bin Faisal University': 'جامعة الإمام عبد الرحمن بن فيصل',
  'Princess Nora Bint Abdulrahman University': 'جامعة الأميرة نورة بنت عبد الرحمن',
  'Al-Imam Mohamed Ibn Saud Islamic University': 'جامعة الإمام محمد بن سعود الإسلامية',
  'Qassim University': 'جامعة القصيم',
  'Taibah University': 'جامعة طيبة',
  'King Faisal University': 'جامعة الملك فيصل',
  'King Khaled University': 'جامعة الملك خالد',
  'Alfaisal University': 'جامعة الفيصل',
  // UAE
  'United Arab Emirates University': 'جامعة الإمارات العربية المتحدة',
  'American University of Sharjah': 'الجامعة الأمريكية بالشارقة',
  'Khalifa University': 'جامعة خليفة',
  'Abu Dhabi University': 'جامعة أبوظبي',
  'University of Dubai': 'جامعة دبي',
  'Zayed University': 'جامعة زايد',
  'Ajman University': 'جامعة عجمان',
  // Other Arab
  'University of Jordan': 'الجامعة الأردنية',
  'Jordan University of Science and Technology': 'جامعة العلوم والتكنولوجيا الأردنية',
  'American University of Beirut': 'الجامعة الأمريكية في بيروت',
  'Beirut Arab University': 'جامعة بيروت العربية',
  'Qatar University': 'جامعة قطر',
  'Kuwait University': 'جامعة الكويت',
  'University of Bahrain': 'جامعة البحرين',
  'Sultan Qaboos University': 'جامعة السلطان قابوس',
  'University of Baghdad': 'جامعة بغداد',
  'Damascus University': 'جامعة دمشق',
  'Yarmouk University': 'جامعة اليرموك',
  'Birzeit University': 'جامعة بيرزيت',
  'University of Khartoum': 'جامعة الخرطوم',
  'University of Tunis': 'جامعة تونس',
  'Algerian universities': 'الجامعات الجزائرية',
  'Mohammed V University': 'جامعة محمد الخامس',
};

export type Locale = 'en' | 'ar';

export function getUniversitiesByCountry(countryCode: string): string[] {
  const code = countryCode?.toUpperCase();
  const list = (universitiesByCountry as Record<string, string[]>)[code];
  return list ?? [];
}

export function getUniversityName(nameEn: string, locale: Locale): string {
  if (locale === 'ar' && UNIVERSITY_AR[nameEn]) {
    return UNIVERSITY_AR[nameEn];
  }
  return nameEn;
}

/** Country codes that have universities in our dataset */
export const UNIVERSITY_COUNTRY_CODES = Object.keys(
  universitiesByCountry as Record<string, string[]>,
).filter((c) => c.length === 2);

/** Get countries that have university data, for the institution select */
export function getCountriesWithUniversities(): { code: string; nameEn: string; nameAr: string }[] {
  return COUNTRIES.filter((c) => UNIVERSITY_COUNTRY_CODES.includes(c.code)).map((c) => ({
    code: c.code,
    nameEn: c.nameEn,
    nameAr: c.nameAr,
  }));
}
