import { notFound } from 'next/navigation';

import { CustomerOnboardingClient } from '@/components/onboarding/customer-onboarding-client';
import { Container } from '@/components/ui/container';
import { isSupportedLocale } from '@/lib/i18n/config';
import { getDictionary } from '@/lib/i18n/get-dictionary';

type CustomerOnboardingPageProps = {
  params: Promise<{
    locale: string;
  }>;
};

const CustomerOnboardingPage = async ({ params }: CustomerOnboardingPageProps) => {
  const { locale } = await params;

  if (!isSupportedLocale(locale)) {
    notFound();
  }

  const dictionary = getDictionary(locale);

  return (
    <main className="customer-onboarding-page-main">
      <Container>
        <h1 className="customer-onboarding-page-title">{dictionary.onboarding.customer.title}</h1>
        <p className="customer-onboarding-page-description">
          {dictionary.onboarding.customer.description}
        </p>
        <CustomerOnboardingClient locale={locale} dictionary={dictionary} />
      </Container>
    </main>
  );
};

export default CustomerOnboardingPage;
