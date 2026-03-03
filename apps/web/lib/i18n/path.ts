import { DEFAULT_LOCALE, isSupportedLocale } from './config';
import type { Locale } from './types';

export const normalizeLocale = (value: string): Locale => {
  return isSupportedLocale(value) ? value : DEFAULT_LOCALE;
};

export const stripLocaleFromPath = (pathname: string): string => {
  const segments = pathname.split('/').filter(Boolean);

  if (segments.length === 0) {
    return '/';
  }

  const firstSegment = segments[0];

  if (firstSegment && isSupportedLocale(firstSegment)) {
    const remaining = segments.slice(1);
    return remaining.length > 0 ? `/${remaining.join('/')}` : '/';
  }

  return pathname;
};

export const buildLocalePath = (locale: Locale, pathWithoutLocale: string): string => {
  const normalizedPath = pathWithoutLocale.startsWith('/')
    ? pathWithoutLocale
    : `/${pathWithoutLocale}`;
  const sanitizedPath = normalizedPath === '/' ? '' : normalizedPath;
  return `/${locale}${sanitizedPath}`;
};
