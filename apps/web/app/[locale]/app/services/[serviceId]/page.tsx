import { notFound } from 'next/navigation';

import { AdvertisedServiceScreen } from '@/components/app/advertisements/ad-destination-screen';
import { isSupportedLocale } from '@/lib/i18n/config';

type Props = { params: Promise<{ locale: string; serviceId: string }> };

const AdvertisedServicePage = async ({ params }: Props) => {
  const { locale, serviceId } = await params;
  if (!isSupportedLocale(locale)) notFound();
  return <AdvertisedServiceScreen locale={locale} serviceId={serviceId} />;
};

export default AdvertisedServicePage;
