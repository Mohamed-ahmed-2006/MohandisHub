import { notFound } from 'next/navigation';

import { CraftsmanOnboardingScreen } from '@/components/onboarding/craftsman-onboarding-screen';
import { isSupportedLocale } from '@/lib/i18n/config';
import { getDictionary } from '@/lib/i18n/get-dictionary';

type CraftsmanOnboardingPageProps = {
  params: Promise<{ locale: string }>;
};

const CraftsmanOnboardingPage = async ({ params }: CraftsmanOnboardingPageProps) => {
  const { locale } = await params;

  if (!isSupportedLocale(locale)) {
    notFound();
  }

  const dictionary = await getDictionary(locale);

  return <CraftsmanOnboardingScreen locale={locale} dictionary={dictionary} />;
};

export default CraftsmanOnboardingPage;
