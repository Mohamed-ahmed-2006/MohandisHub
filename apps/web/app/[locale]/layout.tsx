import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { HtmlLangSync } from '@/components/html-lang-sync';
import { getDirection, isSupportedLocale } from '@/lib/i18n/config';
import { I18nProvider } from '@/lib/i18n/context';
import { getDictionary } from '@/lib/i18n/get-dictionary';
import { localeMetadata } from '@/lib/i18n/metadata';
import type { Locale } from '@/lib/i18n/types';

type LocaleLayoutProps = {
  children: React.ReactNode;
  params: Promise<{
    locale: string;
  }>;
};

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  if (!isSupportedLocale(locale)) return {};
  const meta = localeMetadata[locale];
  return {
    title: meta.title,
    description: meta.description,
  };
}

const LocaleLayout = async ({ children, params }: LocaleLayoutProps) => {
  const { locale } = await params;

  if (!isSupportedLocale(locale)) {
    notFound();
  }

  const localeTyped = locale;
  const dictionary = await getDictionary(localeTyped);

  return (
    <I18nProvider locale={localeTyped} dictionary={dictionary}>
      <HtmlLangSync locale={localeTyped} />
      <div lang={locale} dir={getDirection(localeTyped)}>
        {children}
      </div>
    </I18nProvider>
  );
};

export default LocaleLayout;
