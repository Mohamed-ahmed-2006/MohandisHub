import dynamic from 'next/dynamic';
import { notFound } from 'next/navigation';

import { Container } from '@/components/ui/container';
import { SkeletonCard } from '@/components/ui/skeleton';
import { isSupportedLocale } from '@/lib/i18n/config';

const HistoryScreen = dynamic(
  () => import('@/components/app/history-screen').then((m) => ({ default: m.HistoryScreen })),
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

type HistoryPageProps = {
  params: Promise<{ locale: string }>;
};

const HistoryPage = async ({ params }: HistoryPageProps) => {
  const { locale } = await params;
  if (!isSupportedLocale(locale)) notFound();
  return <HistoryScreen />;
};

export default HistoryPage;
