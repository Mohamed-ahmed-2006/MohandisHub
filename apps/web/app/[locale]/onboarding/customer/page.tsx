import { notFound } from 'next/navigation';

import { CustomerOnboardingScreen } from '@/components/onboarding/customer-onboarding-screen';
import { isSupportedLocale } from '@/lib/i18n/config';
import { getDictionary } from '@/lib/i18n/get-dictionary';

type CustomerOnboardingPageProps = {
  params: Promise<{ locale: string }>;
};

const CustomerOnboardingPage = async ({ params }: CustomerOnboardingPageProps) => {
  const { locale } = await params;

  if (!isSupportedLocale(locale)) {
    notFound();
  }

  const dictionary = await getDictionary(locale);

  return <CustomerOnboardingScreen locale={locale} dictionary={dictionary} />;
};

export default CustomerOnboardingPage;
