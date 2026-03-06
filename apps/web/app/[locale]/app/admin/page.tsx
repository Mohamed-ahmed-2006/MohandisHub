import dynamic from 'next/dynamic';
import { notFound } from 'next/navigation';

import { Container } from '@/components/ui/container';
import { SkeletonCard } from '@/components/ui/skeleton';
import { isSupportedLocale } from '@/lib/i18n/config';
import { getDictionary } from '@/lib/i18n/get-dictionary';

const AdminPanel = dynamic(
  () => import('@/components/admin/admin-panel').then((m) => ({ default: m.AdminPanel })),
  {
    loading: () => (
      <main className="admin-panel-main">
        <Container className="admin-panel-container">
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            <SkeletonCard />
            <SkeletonCard />
            <SkeletonCard />
          </div>
        </Container>
      </main>
    ),
  },
);

type AdminPageProps = {
  params: Promise<{
    locale: string;
  }>;
};

const AdminPage = async ({ params }: AdminPageProps) => {
  const { locale } = await params;

  if (!isSupportedLocale(locale)) {
    notFound();
  }

  const dictionary = getDictionary(locale);

  return <AdminPanel locale={locale} dictionary={dictionary} />;
};

export default AdminPage;
