'use client';

import { useEffect } from 'react';

import { getDirection } from '@/lib/i18n/config';
import type { Locale } from '@/lib/i18n/types';

type HtmlLangSyncProps = { locale: Locale };

export function HtmlLangSync({ locale }: HtmlLangSyncProps) {
  useEffect(() => {
    const html = document.documentElement;
    html.setAttribute('lang', locale);
    html.setAttribute('dir', getDirection(locale));
  }, [locale]);
  return null;
}
