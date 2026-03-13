import { notFound } from 'next/navigation';

import { BusinessOnboardingScreen } from '@/components/onboarding/business-onboarding-screen';
import { isSupportedLocale } from '@/lib/i18n/config';
import { getDictionary } from '@/lib/i18n/get-dictionary';

type BusinessOnboardingPageProps = {
  params: Promise<{ locale: string }>;
};

const BusinessOnboardingPage = async ({ params }: BusinessOnboardingPageProps) => {
  const { locale } = await params;

  if (!isSupportedLocale(locale)) {
    notFound();
  }

  const dictionary = await getDictionary(locale);

  return <BusinessOnboardingScreen locale={locale} dictionary={dictionary} />;
};

export default BusinessOnboardingPage;
