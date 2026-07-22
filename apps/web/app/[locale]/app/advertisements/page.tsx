import { notFound, redirect } from 'next/navigation';

import { MyAdsScreen } from '@/components/app/advertisements/my-ads-screen';
import { isAdsUiEnabled } from '@/lib/advertisements/feature';
import { isSupportedLocale } from '@/lib/i18n/config';
import { getDictionary } from '@/lib/i18n/get-dictionary';
import { buildLocalePath } from '@/lib/i18n/path';

type AdvertisementsPageProps = {
  params: Promise<{ locale: string }>;
};

const AdvertisementsPage = async ({ params }: AdvertisementsPageProps) => {
  const { locale } = await params;
  if (!isSupportedLocale(locale)) notFound();
  if (!isAdsUiEnabled()) redirect(buildLocalePath(locale, '/app'));
  const dictionary = await getDictionary(locale);
  return <MyAdsScreen locale={locale} dictionary={dictionary} />;
};

export default AdvertisementsPage;
