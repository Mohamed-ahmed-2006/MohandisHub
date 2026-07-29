import dynamic from 'next/dynamic';
import { notFound } from 'next/navigation';

import { Container } from '@/components/ui/container';
import { SkeletonCard } from '@/components/ui/skeleton';
import { isSupportedLocale } from '@/lib/i18n/config';

const ProviderAnalyticsScreen = dynamic(
  () => import('@/components/app/provider-analytics-screen').then((m) => ({ default: m.ProviderAnalyticsScreen })),
  {
    loading: () => (
      <Container>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', padding: '2rem 0' }}>
          <SkeletonCard />
          <SkeletonCard />
        </div>
      </Container>
    ),
  },
);

type AnalyticsPageProps = {
  params: Promise<{ locale: string }>;
};

const AnalyticsPage = async ({ params }: AnalyticsPageProps) => {
  const { locale } = await params;
  if (!isSupportedLocale(locale)) notFound();
  return <ProviderAnalyticsScreen />;
};

export default AnalyticsPage;
