import dynamic from 'next/dynamic';
import { notFound } from 'next/navigation';

import { Container } from '@/components/ui/container';
import { SkeletonCard } from '@/components/ui/skeleton';
import { isSupportedLocale } from '@/lib/i18n/config';

const BookingsScreen = dynamic(
  () => import('@/components/app/bookings-screen').then((m) => ({ default: m.BookingsScreen })),
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

type BookingsPageProps = {
  params: Promise<{ locale: string }>;
};

const BookingsPage = async ({ params }: BookingsPageProps) => {
  const { locale } = await params;
  if (!isSupportedLocale(locale)) notFound();
  return <BookingsScreen />;
};

export default BookingsPage;
