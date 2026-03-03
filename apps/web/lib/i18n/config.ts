import type { Locale } from './types';

export const SUPPORTED_LOCALES = ['en', 'ar'] as const;
export const DEFAULT_LOCALE: Locale = 'en';

export const isSupportedLocale = (value: string): value is Locale => {
  return SUPPORTED_LOCALES.includes(value as Locale);
};

export const getDirection = (locale: Locale): 'ltr' | 'rtl' => {
  return locale === 'ar' ? 'rtl' : 'ltr';
};
