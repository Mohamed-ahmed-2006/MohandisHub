import { notFound } from 'next/navigation';

import { ExpertOnboardingClient } from '@/components/onboarding/expert-onboarding-client';
import { Container } from '@/components/ui/container';
import { isSupportedLocale } from '@/lib/i18n/config';
import { getDictionary } from '@/lib/i18n/get-dictionary';

type ExpertOnboardingPageProps = {
  params: Promise<{
    locale: string;
  }>;
};

const ExpertOnboardingPage = async ({ params }: ExpertOnboardingPageProps) => {
  const { locale } = await params;

  if (!isSupportedLocale(locale)) {
    notFound();
  }

  const dictionary = getDictionary(locale);

  return (
    <main className="expert-onboarding-page-main">
      <Container>
        <h1 className="expert-onboarding-page-title">{dictionary.onboarding.expert.title}</h1>
        <p className="expert-onboarding-page-description">
          {dictionary.onboarding.expert.description}
        </p>
        <ExpertOnboardingClient locale={locale} dictionary={dictionary} />
      </Container>
    </main>
  );
};

export default ExpertOnboardingPage;
