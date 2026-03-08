import { notFound } from 'next/navigation';

import { CalendarScreen } from '@/components/app/calendar-screen';
import { isSupportedLocale } from '@/lib/i18n/config';
import { getDictionary } from '@/lib/i18n/get-dictionary';

type CalendarPageProps = {
  params: Promise<{ locale: string }>;
};

const CalendarPage = async ({ params }: CalendarPageProps) => {
  const { locale } = await params;
  if (!isSupportedLocale(locale)) notFound();
  const dictionary = getDictionary(locale);
  return <CalendarScreen locale={locale} dictionary={dictionary} />;
};

export default CalendarPage;
