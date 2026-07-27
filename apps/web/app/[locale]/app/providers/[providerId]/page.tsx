import { notFound } from 'next/navigation';

import { AdvertisedProviderScreen } from '@/components/app/advertisements/ad-destination-screen';
import { isSupportedLocale } from '@/lib/i18n/config';

type Props = { params: Promise<{ locale: string; providerId: string }> };

const AdvertisedProviderPage = async ({ params }: Props) => {
  const { locale, providerId } = await params;
  if (!isSupportedLocale(locale)) notFound();
  return <AdvertisedProviderScreen locale={locale} providerId={providerId} />;
};

export default AdvertisedProviderPage;
