import { notFound } from 'next/navigation';

import { HistoryScreen } from '@/components/app/history-screen';
import { isSupportedLocale } from '@/lib/i18n/config';
import { getDictionary } from '@/lib/i18n/get-dictionary';

type HistoryPageProps = {
  params: Promise<{ locale: string }>;
};

const HistoryPage = async ({ params }: HistoryPageProps) => {
  const { locale } = await params;
  if (!isSupportedLocale(locale)) notFound();
  const dictionary = getDictionary(locale);
  return <HistoryScreen locale={locale} dictionary={dictionary} />;
};

export default HistoryPage;
