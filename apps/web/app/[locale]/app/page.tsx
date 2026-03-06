import { notFound } from 'next/navigation';

import { AppHomeScreen } from '@/components/app/app-home-screen';
import { isSupportedLocale } from '@/lib/i18n/config';
import { getDictionary } from '@/lib/i18n/get-dictionary';

type AppPageProps = {
  params: Promise<{
    locale: string;
  }>;
};

const AppPage = async ({ params }: AppPageProps) => {
  const { locale } = await params;

  if (!isSupportedLocale(locale)) {
    notFound();
  }

  const dictionary = getDictionary(locale);

  return <AppHomeScreen locale={locale} dictionary={dictionary} />;
};

export default AppPage;
