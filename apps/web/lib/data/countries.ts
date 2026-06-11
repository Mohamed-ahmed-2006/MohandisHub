export type CountryEntry = {
  code: string;
  nameEn: string;
  nameAr: string;
  dialCode: string;
};

export const COUNTRIES: CountryEntry[] = [
  { code: 'EG', nameEn: 'Egypt', nameAr: 'مصر', dialCode: '+20' },
  { code: 'SA', nameEn: 'Saudi Arabia', nameAr: 'السعودية', dialCode: '+966' },
  { code: 'AE', nameEn: 'United Arab Emirates', nameAr: 'الإمارات', dialCode: '+971' },
  { code: 'KW', nameEn: 'Kuwait', nameAr: 'الكويت', dialCode: '+965' },
  { code: 'QA', nameEn: 'Qatar', nameAr: 'قطر', dialCode: '+974' },
  { code: 'BH', nameEn: 'Bahrain', nameAr: 'البحرين', dialCode: '+973' },
  { code: 'OM', nameEn: 'Oman', nameAr: 'عمان', dialCode: '+968' },
  { code: 'JO', nameEn: 'Jordan', nameAr: 'الأردن', dialCode: '+962' },
  { code: 'LB', nameEn: 'Lebanon', nameAr: 'لبنان', dialCode: '+961' },
  { code: 'IQ', nameEn: 'Iraq', nameAr: 'العراق', dialCode: '+964' },
  { code: 'SY', nameEn: 'Syria', nameAr: 'سوريا', dialCode: '+963' },
  { code: 'PS', nameEn: 'Palestine', nameAr: 'فلسطين', dialCode: '+970' },
  { code: 'YE', nameEn: 'Yemen', nameAr: 'اليمن', dialCode: '+967' },
  { code: 'LY', nameEn: 'Libya', nameAr: 'ليبيا', dialCode: '+218' },
  { code: 'TN', nameEn: 'Tunisia', nameAr: 'تونس', dialCode: '+216' },
  { code: 'DZ', nameEn: 'Algeria', nameAr: 'الجزائر', dialCode: '+213' },
  { code: 'MA', nameEn: 'Morocco', nameAr: 'المغرب', dialCode: '+212' },
  { code: 'SD', nameEn: 'Sudan', nameAr: 'السودان', dialCode: '+249' },
  { code: 'SO', nameEn: 'Somalia', nameAr: 'الصومال', dialCode: '+252' },
  { code: 'MR', nameEn: 'Mauritania', nameAr: 'موريتانيا', dialCode: '+222' },
  { code: 'DJ', nameEn: 'Djibouti', nameAr: 'جيبوتي', dialCode: '+253' },
  { code: 'KM', nameEn: 'Comoros', nameAr: 'جزر القمر', dialCode: '+269' },
  { code: 'US', nameEn: 'United States', nameAr: 'الولايات المتحدة', dialCode: '+1' },
  { code: 'GB', nameEn: 'United Kingdom', nameAr: 'المملكة المتحدة', dialCode: '+44' },
  { code: 'CA', nameEn: 'Canada', nameAr: 'كندا', dialCode: '+1' },
  { code: 'DE', nameEn: 'Germany', nameAr: 'ألمانيا', dialCode: '+49' },
  { code: 'FR', nameEn: 'France', nameAr: 'فرنسا', dialCode: '+33' },
  { code: 'IT', nameEn: 'Italy', nameAr: 'إيطاليا', dialCode: '+39' },
  { code: 'ES', nameEn: 'Spain', nameAr: 'إسبانيا', dialCode: '+34' },
  { code: 'NL', nameEn: 'Netherlands', nameAr: 'هولندا', dialCode: '+31' },
  { code: 'SE', nameEn: 'Sweden', nameAr: 'السويد', dialCode: '+46' },
  { code: 'NO', nameEn: 'Norway', nameAr: 'النرويج', dialCode: '+47' },
  { code: 'DK', nameEn: 'Denmark', nameAr: 'الدنمارك', dialCode: '+45' },
  { code: 'CH', nameEn: 'Switzerland', nameAr: 'سويسرا', dialCode: '+41' },
  { code: 'AT', nameEn: 'Austria', nameAr: 'النمسا', dialCode: '+43' },
  { code: 'BE', nameEn: 'Belgium', nameAr: 'بلجيكا', dialCode: '+32' },
  { code: 'PL', nameEn: 'Poland', nameAr: 'بولندا', dialCode: '+48' },
  { code: 'PT', nameEn: 'Portugal', nameAr: 'البرتغال', dialCode: '+351' },
  { code: 'GR', nameEn: 'Greece', nameAr: 'اليونان', dialCode: '+30' },
  { code: 'TR', nameEn: 'Turkey', nameAr: 'تركيا', dialCode: '+90' },
  { code: 'RU', nameEn: 'Russia', nameAr: 'روسيا', dialCode: '+7' },
  { code: 'IN', nameEn: 'India', nameAr: 'الهند', dialCode: '+91' },
  { code: 'PK', nameEn: 'Pakistan', nameAr: 'باكستان', dialCode: '+92' },
  { code: 'BD', nameEn: 'Bangladesh', nameAr: 'بنغلاديش', dialCode: '+880' },
  { code: 'CN', nameEn: 'China', nameAr: 'الصين', dialCode: '+86' },
  { code: 'JP', nameEn: 'Japan', nameAr: 'اليابان', dialCode: '+81' },
  { code: 'KR', nameEn: 'South Korea', nameAr: 'كوريا الجنوبية', dialCode: '+82' },
  { code: 'MY', nameEn: 'Malaysia', nameAr: 'ماليزيا', dialCode: '+60' },
  { code: 'ID', nameEn: 'Indonesia', nameAr: 'إندونيسيا', dialCode: '+62' },
  { code: 'PH', nameEn: 'Philippines', nameAr: 'الفلبين', dialCode: '+63' },
  { code: 'SG', nameEn: 'Singapore', nameAr: 'سنغافورة', dialCode: '+65' },
  { code: 'AU', nameEn: 'Australia', nameAr: 'أستراليا', dialCode: '+61' },
  { code: 'NZ', nameEn: 'New Zealand', nameAr: 'نيوزيلندا', dialCode: '+64' },
  { code: 'ZA', nameEn: 'South Africa', nameAr: 'جنوب أفريقيا', dialCode: '+27' },
  { code: 'NG', nameEn: 'Nigeria', nameAr: 'نيجيريا', dialCode: '+234' },
  { code: 'KE', nameEn: 'Kenya', nameAr: 'كينيا', dialCode: '+254' },
  { code: 'GH', nameEn: 'Ghana', nameAr: 'غانا', dialCode: '+233' },
  { code: 'BR', nameEn: 'Brazil', nameAr: 'البرازيل', dialCode: '+55' },
  { code: 'MX', nameEn: 'Mexico', nameAr: 'المكسيك', dialCode: '+52' },
  { code: 'AR', nameEn: 'Argentina', nameAr: 'الأرجنتين', dialCode: '+54' },
  { code: 'CO', nameEn: 'Colombia', nameAr: 'كولومبيا', dialCode: '+57' },
  { code: 'CL', nameEn: 'Chile', nameAr: 'تشيلي', dialCode: '+56' },
];

export const DEFAULT_COUNTRY_CODE = 'EG';

export const findCountryByCode = (code: string): CountryEntry | undefined =>
  COUNTRIES.find((c) => c.code === code.toUpperCase());

export const findCountryByName = (name: string): CountryEntry | undefined =>
  COUNTRIES.find((c) => c.nameEn === name || c.nameAr === name || c.code === name.toUpperCase());

export const getDialCodeForCountry = (code: string): string =>
  findCountryByCode(code)?.dialCode ?? '+20';
