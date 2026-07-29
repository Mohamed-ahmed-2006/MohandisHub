import dynamic from 'next/dynamic';
import { notFound } from 'next/navigation';

import { Container } from '@/components/ui/container';
import { SkeletonCard } from '@/components/ui/skeleton';
import { isSupportedLocale } from '@/lib/i18n/config';

const MhcCreditsScreen = dynamic(
  () => import('@/components/app/mhc-credits-screen').then((m) => ({ default: m.MhcCreditsScreen })),
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

type CreditsPageProps = {
  params: Promise<{ locale: string }>;
};

const CreditsPage = async ({ params }: CreditsPageProps) => {
  const { locale } = await params;
  if (!isSupportedLocale(locale)) notFound();
  return <MhcCreditsScreen />;
};

export default CreditsPage;
