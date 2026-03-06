import { notFound } from 'next/navigation';

import { AppShell } from '@/components/app/app-shell';
import { isSupportedLocale } from '@/lib/i18n/config';
import { getDictionary } from '@/lib/i18n/get-dictionary';

type AppLayoutProps = {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
};

const AppLayout = async ({ children, params }: AppLayoutProps) => {
  const { locale } = await params;

  if (!isSupportedLocale(locale)) {
    notFound();
  }

  const dictionary = getDictionary(locale);

  return (
    <AppShell locale={locale} dictionary={dictionary}>
      {children}
    </AppShell>
  );
};

export default AppLayout;
