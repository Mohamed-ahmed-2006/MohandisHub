import { notFound } from 'next/navigation';

import { WalletSettingsScreen } from '@/components/app/wallet-settings-screen';
import { isSupportedLocale } from '@/lib/i18n/config';
import { getDictionary } from '@/lib/i18n/get-dictionary';

type WalletSettingsPageProps = {
  params: Promise<{ locale: string }>;
};

const WalletSettingsPage = async ({ params }: WalletSettingsPageProps) => {
  const { locale } = await params;
  if (!isSupportedLocale(locale)) notFound();
  const dictionary = getDictionary(locale);
  return <WalletSettingsScreen locale={locale} dictionary={dictionary} />;
};

export default WalletSettingsPage;
