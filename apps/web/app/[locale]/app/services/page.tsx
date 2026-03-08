import { notFound } from 'next/navigation';

import { ServicesScreen } from '@/components/app/services-screen';
import { isSupportedLocale } from '@/lib/i18n/config';
import { getDictionary } from '@/lib/i18n/get-dictionary';

type ServicesPageProps = {
  params: Promise<{ locale: string }>;
};

const ServicesPage = async ({ params }: ServicesPageProps) => {
  const { locale } = await params;
  if (!isSupportedLocale(locale)) notFound();
  const dictionary = getDictionary(locale);
  return <ServicesScreen locale={locale} dictionary={dictionary} />;
};

export default ServicesPage;
