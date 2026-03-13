import dynamic from 'next/dynamic';
import { notFound } from 'next/navigation';

import { Container } from '@/components/ui/container';
import { SkeletonCard } from '@/components/ui/skeleton';
import { isSupportedLocale } from '@/lib/i18n/config';

const CalendarScreen = dynamic(
  () => import('@/components/app/calendar-screen').then((m) => ({ default: m.CalendarScreen })),
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

type CalendarPageProps = {
  params: Promise<{ locale: string }>;
};

const CalendarPage = async ({ params }: CalendarPageProps) => {
  const { locale } = await params;
  if (!isSupportedLocale(locale)) notFound();
  return <CalendarScreen />;
};

export default CalendarPage;
