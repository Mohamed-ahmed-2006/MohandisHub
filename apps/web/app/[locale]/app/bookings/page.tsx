import { notFound } from 'next/navigation';

import { BookingsScreen } from '@/components/app/bookings-screen';
import { isSupportedLocale } from '@/lib/i18n/config';
import { getDictionary } from '@/lib/i18n/get-dictionary';

type BookingsPageProps = {
  params: Promise<{ locale: string }>;
};

const BookingsPage = async ({ params }: BookingsPageProps) => {
  const { locale } = await params;
  if (!isSupportedLocale(locale)) notFound();
  const dictionary = getDictionary(locale);
  return <BookingsScreen locale={locale} dictionary={dictionary} />;
};

export default BookingsPage;
