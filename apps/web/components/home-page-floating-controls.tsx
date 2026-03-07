'use client';

import { useEffect, useState } from 'react';

import { LanguageToggle } from '@/components/language-toggle';
import { ThemeToggle } from '@/components/theme-toggle';
import type { Dictionary, Locale } from '@/lib/i18n/types';

const SCROLL_THRESHOLD = 80;

type Props = {
  locale: Locale;
  dictionary: Dictionary;
};

export function HomePageFloatingControls({ locale, dictionary }: Props) {
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    const check = () => {
      setVisible(window.scrollY <= SCROLL_THRESHOLD);
    };
    check();
    window.addEventListener('scroll', check, { passive: true });
    return () => window.removeEventListener('scroll', check);
  }, []);

  if (!visible) return null;

  return (
    <div className="home-page-floating-controls">
      <LanguageToggle
        locale={locale}
        targetLabel={dictionary.language.target}
        ariaLabel={dictionary.language.switchLabel}
      />
      <ThemeToggle
        switchToLightLabel={dictionary.theme.switchToLight}
        switchToDarkLabel={dictionary.theme.switchToDark}
        darkLabel={dictionary.theme.darkLabel}
        lightLabel={dictionary.theme.lightLabel}
      />
    </div>
  );
}
