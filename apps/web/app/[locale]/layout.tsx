import { notFound } from 'next/navigation';

import { getDirection, isSupportedLocale } from '@/lib/i18n/config';

type LocaleLayoutProps = {
  children: React.ReactNode;
  params: Promise<{
    locale: string;
  }>;
};

const LocaleLayout = async ({ children, params }: LocaleLayoutProps) => {
  const { locale } = await params;

  if (!isSupportedLocale(locale)) {
    notFound();
  }

  return (
    <div lang={locale} dir={getDirection(locale)}>
      {children}
    </div>
  );
};

export default LocaleLayout;
