import { notFound } from 'next/navigation';

import { NegotiationsScreen } from '@/components/app/negotiations-screen';
import { isSupportedLocale } from '@/lib/i18n/config';
import { getDictionary } from '@/lib/i18n/get-dictionary';

type PageProps = {
  params: Promise<{ locale: string }>;
};

const NegotiationsPage = async ({ params }: PageProps) => {
  const { locale } = await params;
  if (!isSupportedLocale(locale)) notFound();
  const dictionary = await getDictionary(locale);
  return <NegotiationsScreen locale={locale} dictionary={dictionary} />;
};

export default NegotiationsPage;
