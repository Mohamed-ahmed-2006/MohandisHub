'use client';

import { usePathname, useRouter } from 'next/navigation';

import { buildLocalePath, stripLocaleFromPath } from '@/lib/i18n/path';
import type { Locale } from '@/lib/i18n/types';

const LANGUAGE_STORAGE_KEY = 'mohandishub-language';

type LanguageToggleProps = {
  locale: Locale;
  targetLabel: string;
  ariaLabel: string;
};

export const LanguageToggle = ({ locale, targetLabel, ariaLabel }: LanguageToggleProps) => {
  const router = useRouter();
  const pathname = usePathname();

  const nextLocale: Locale = locale === 'en' ? 'ar' : 'en';

  const handleToggle = (): void => {
    const pathWithoutLocale = stripLocaleFromPath(pathname);
    const nextPath = buildLocalePath(nextLocale, pathWithoutLocale);

    document.cookie = `mohandishub-language=${nextLocale}; path=/; max-age=31536000; SameSite=Lax`;
    window.localStorage.setItem(LANGUAGE_STORAGE_KEY, nextLocale);

    router.push(nextPath);
  };

  return (
    <button
      type="button"
      className="language-toggle-button"
      aria-label={ariaLabel}
      onClick={handleToggle}
    >
      <span className="language-toggle-target">{targetLabel}</span>
    </button>
  );
};
