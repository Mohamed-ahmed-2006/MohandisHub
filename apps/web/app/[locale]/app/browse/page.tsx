import { notFound, redirect } from 'next/navigation';

import { isSupportedLocale } from '@/lib/i18n/config';

type BrowsePageProps = {
  params: Promise<{ locale: string }>;
};

const BrowsePage = async ({ params }: BrowsePageProps) => {
  const { locale } = await params;
  if (!isSupportedLocale(locale)) notFound();
  redirect(`/${locale}/app/services`);
};

export default BrowsePage;
