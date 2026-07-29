import { notFound, redirect } from 'next/navigation';

import { isSupportedLocale } from '@/lib/i18n/config';

type WalletSettingsPageProps = {
  params: Promise<{ locale: string }>;
};

const WalletSettingsPage = async ({ params }: WalletSettingsPageProps) => {
  const { locale } = await params;
  if (!isSupportedLocale(locale)) notFound();
  redirect(`/${locale}/app/settings?tab=wallet`);
};

export default WalletSettingsPage;
