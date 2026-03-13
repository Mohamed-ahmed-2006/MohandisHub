import { notFound } from 'next/navigation';

import { MyPlanScreen } from '@/components/app/my-plan-screen';
import { isSupportedLocale } from '@/lib/i18n/config';
import { getDictionary } from '@/lib/i18n/get-dictionary';

type PlanPageProps = {
  params: Promise<{ locale: string }>;
};

const PlanPage = async ({ params }: PlanPageProps) => {
  const { locale } = await params;
  if (!isSupportedLocale(locale)) notFound();
  const dictionary = await getDictionary(locale);
  return <MyPlanScreen locale={locale} dictionary={dictionary} />;
};

export default PlanPage;
