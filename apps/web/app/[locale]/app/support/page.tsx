import dynamic from 'next/dynamic';
import { notFound } from 'next/navigation';

import { Container } from '@/components/ui/container';
import { SkeletonCard } from '@/components/ui/skeleton';
import { isSupportedLocale } from '@/lib/i18n/config';

const SupportScreen = dynamic(
  () => import('@/components/app/support-screen').then((m) => ({ default: m.SupportScreen })),
  {
    loading: () => (
      <Container>
        <SkeletonCard />
      </Container>
    ),
  },
);

type SupportPageProps = {
  params: Promise<{ locale: string }>;
};

const SupportPage = async ({ params }: SupportPageProps) => {
  const { locale } = await params;
  if (!isSupportedLocale(locale)) notFound();
  return <SupportScreen />;
};

export default SupportPage;
