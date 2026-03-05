import { notFound } from 'next/navigation';

import { BusinessOnboardingClient } from '@/components/onboarding/business-onboarding-client';
import { Container } from '@/components/ui/container';
import { isSupportedLocale } from '@/lib/i18n/config';
import { getDictionary } from '@/lib/i18n/get-dictionary';

type BusinessOnboardingPageProps = {
  params: Promise<{
    locale: string;
  }>;
};

const BusinessOnboardingPage = async ({ params }: BusinessOnboardingPageProps) => {
  const { locale } = await params;

  if (!isSupportedLocale(locale)) {
    notFound();
  }

  const dictionary = getDictionary(locale);

  return (
    <main className="business-onboarding-page-main">
      <Container>
        <h1 className="business-onboarding-page-title">{dictionary.onboarding.business.title}</h1>
        <p className="business-onboarding-page-description">
          {dictionary.onboarding.business.description}
        </p>
        <BusinessOnboardingClient locale={locale} dictionary={dictionary} />
      </Container>
    </main>
  );
};

export default BusinessOnboardingPage;
