import { notFound } from 'next/navigation';

import { ExpertOnboardingScreen } from '@/components/onboarding/expert-onboarding-screen';
import { isSupportedLocale } from '@/lib/i18n/config';
import { getDictionary } from '@/lib/i18n/get-dictionary';

type ExpertOnboardingPageProps = {
  params: Promise<{ locale: string }>;
};

const ExpertOnboardingPage = async ({ params }: ExpertOnboardingPageProps) => {
  const { locale } = await params;

  if (!isSupportedLocale(locale)) {
    notFound();
  }

  const dictionary = await getDictionary(locale);

  return <ExpertOnboardingScreen locale={locale} dictionary={dictionary} />;
};

export default ExpertOnboardingPage;
