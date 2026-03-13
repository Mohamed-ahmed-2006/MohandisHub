import dynamic from 'next/dynamic';
import { notFound } from 'next/navigation';

import { Container } from '@/components/ui/container';
import { SkeletonCard } from '@/components/ui/skeleton';
import { isSupportedLocale } from '@/lib/i18n/config';

const WalletSettingsScreen = dynamic(
  () =>
    import('@/components/app/wallet-settings-screen').then((m) => ({
      default: m.WalletSettingsScreen,
    })),
  {
    loading: () => (
      <Container>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <SkeletonCard />
          <SkeletonCard />
        </div>
      </Container>
    ),
  },
);

type WalletSettingsPageProps = {
  params: Promise<{ locale: string }>;
};

const WalletSettingsPage = async ({ params }: WalletSettingsPageProps) => {
  const { locale } = await params;
  if (!isSupportedLocale(locale)) notFound();
  return <WalletSettingsScreen />;
};

export default WalletSettingsPage;
