import { notFound } from 'next/navigation';

import { SecondHomeShell } from '@/components/app/second-home-shell';
import { Container } from '@/components/ui/container';
import { isSupportedLocale } from '@/lib/i18n/config';
import { getDictionary } from '@/lib/i18n/get-dictionary';

type AppHomePageProps = {
  params: Promise<{
    locale: string;
  }>;
};

const AppHomePage = async ({ params }: AppHomePageProps) => {
  const { locale } = await params;

  if (!isSupportedLocale(locale)) {
    notFound();
  }

  const dictionary = getDictionary(locale);

  return (
    <main className="app-home-main">
      <Container>
        <SecondHomeShell locale={locale} dictionary={dictionary} />
      </Container>
    </main>
  );
};

export default AppHomePage;
