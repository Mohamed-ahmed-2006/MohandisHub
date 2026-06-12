import dynamic from 'next/dynamic';
import { notFound } from 'next/navigation';

import { Container } from '@/components/ui/container';
import { SkeletonCard } from '@/components/ui/skeleton';
import { isSupportedLocale } from '@/lib/i18n/config';

const DisputesScreen = dynamic(
  () => import('@/components/app/disputes-screen').then((m) => ({ default: m.DisputesScreen })),
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

type DisputesPageProps = {
  params: Promise<{ locale: string }>;
};

const DisputesPage = async ({ params }: DisputesPageProps) => {
  const { locale } = await params;
  if (!isSupportedLocale(locale)) notFound();
  return <DisputesScreen />;
};

export default DisputesPage;
