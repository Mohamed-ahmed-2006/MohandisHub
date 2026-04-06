import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';

import { DEFAULT_LOCALE, isSupportedLocale } from './lib/i18n/config';

const LANGUAGE_COOKIE_KEY = 'mohandishub-language';

const resolveLocaleFromHeader = (acceptLanguage: string | null): 'en' | 'ar' | null => {
  if (!acceptLanguage) {
    return null;
  }

  const normalized = acceptLanguage.toLowerCase();

  if (normalized.includes('ar')) {
    return 'ar';
  }

  if (normalized.includes('en')) {
    return 'en';
  }

  return null;
};

/** App-root metadata and asset routes (no `[locale]` segment) — do not prefix with /en or /ar. */
const LOCALE_SKIP_FIRST_SEGMENTS = new Set([
  'brand-icons',
  'apple-icon',
  'opengraph-image',
  'twitter-image',
]);

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  const segments = pathname.split('/').filter(Boolean);
  const maybeLocale = segments[0];

  if (maybeLocale && LOCALE_SKIP_FIRST_SEGMENTS.has(maybeLocale)) {
    return NextResponse.next();
  }

  if (maybeLocale && isSupportedLocale(maybeLocale)) {
    return NextResponse.next();
  }

  const localeFromCookie = request.cookies.get(LANGUAGE_COOKIE_KEY)?.value;
  const localeFromHeader = resolveLocaleFromHeader(request.headers.get('accept-language'));

  const resolvedLocale =
    (localeFromCookie && isSupportedLocale(localeFromCookie) ? localeFromCookie : null) ??
    localeFromHeader ??
    DEFAULT_LOCALE;

  const url = request.nextUrl.clone();
  const normalizedPathname = pathname.startsWith('/') ? pathname : `/${pathname}`;
  url.pathname = `/${resolvedLocale}${normalizedPathname === '/' ? '' : normalizedPathname}`;

  return NextResponse.redirect(url);
}

export const config = {
  matcher: ['/((?!_next|api|health|.*\\..*).*)'],
};
