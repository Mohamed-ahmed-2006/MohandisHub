import dynamic from 'next/dynamic';
import { notFound } from 'next/navigation';
import { Suspense } from 'react';

import { Container } from '@/components/ui/container';
import { SkeletonCard } from '@/components/ui/skeleton';
import { isSupportedLocale } from '@/lib/i18n/config';

const HelpResolutionScreen = dynamic(
  () =>
    import('@/components/app/help-resolution-screen').then((m) => ({
      default: m.HelpResolutionScreen,
    })),
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

  return (
    <Suspense
      fallback={
        <Container>
          <SkeletonCard />
        </Container>
      }
    >
      <HelpResolutionScreen defaultTab="support" />
    </Suspense>
  );
};

export default SupportPage;
