import { notFound } from 'next/navigation';

import { ComingSoonPage } from '@/components/app/coming-soon-page';
import { isSupportedLocale } from '@/lib/i18n/config';
import { getDictionary } from '@/lib/i18n/get-dictionary';

type BrowsePageProps = {
  params: Promise<{ locale: string }>;
};

const BrowsePage = async ({ params }: BrowsePageProps) => {
  const { locale } = await params;
  if (!isSupportedLocale(locale)) notFound();
  const dictionary = getDictionary(locale);
  return <ComingSoonPage locale={locale} dictionary={dictionary} title={dictionary.nav.browse} />;
};

export default BrowsePage;
