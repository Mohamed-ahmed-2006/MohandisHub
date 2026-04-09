import { notFound } from 'next/navigation';

import { MyAdsScreen } from '@/components/app/advertisements/my-ads-screen';
import { isSupportedLocale } from '@/lib/i18n/config';
import { getDictionary } from '@/lib/i18n/get-dictionary';

type AdvertisementsPageProps = {
  params: Promise<{ locale: string }>;
};

const AdvertisementsPage = async ({ params }: AdvertisementsPageProps) => {
  const { locale } = await params;
  if (!isSupportedLocale(locale)) notFound();
  const dictionary = await getDictionary(locale);
  return <MyAdsScreen locale={locale} dictionary={dictionary} />;
};

export default AdvertisementsPage;

