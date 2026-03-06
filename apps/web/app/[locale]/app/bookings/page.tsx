import { notFound } from 'next/navigation';

import { ComingSoonPage } from '@/components/app/coming-soon-page';
import { isSupportedLocale } from '@/lib/i18n/config';
import { getDictionary } from '@/lib/i18n/get-dictionary';

type BookingsPageProps = {
  params: Promise<{ locale: string }>;
};

const BookingsPage = async ({ params }: BookingsPageProps) => {
  const { locale } = await params;
  if (!isSupportedLocale(locale)) notFound();
  const dictionary = getDictionary(locale);
  return <ComingSoonPage locale={locale} dictionary={dictionary} title={dictionary.nav.bookings} />;
};

export default BookingsPage;
