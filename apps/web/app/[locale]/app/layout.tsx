import { notFound } from 'next/navigation';

import { AppShell } from '@/components/app/app-shell';
import { isSupportedLocale } from '@/lib/i18n/config';

type AppLayoutProps = {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
};

const AppLayout = async ({ children, params }: AppLayoutProps) => {
  const { locale } = await params;

  if (!isSupportedLocale(locale)) {
    notFound();
  }

  return <AppShell>{children}</AppShell>;
};

export default AppLayout;
