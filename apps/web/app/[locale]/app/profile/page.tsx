import dynamic from 'next/dynamic';
import { notFound } from 'next/navigation';

import { Container } from '@/components/ui/container';
import { SkeletonForm } from '@/components/ui/skeleton';
import { isSupportedLocale } from '@/lib/i18n/config';
import { getDictionary } from '@/lib/i18n/get-dictionary';

const ProfileScreen = dynamic(
  () => import('@/components/profile/profile-screen').then((m) => ({ default: m.ProfileScreen })),
  {
    loading: () => (
      <main className="profile-screen-main">
        <Container className="profile-screen-container">
          <div className="skeleton-card">
            <SkeletonForm fields={6} />
          </div>
        </Container>
      </main>
    ),
  },
);

type ProfilePageProps = {
  params: Promise<{
    locale: string;
  }>;
};

const ProfilePage = async ({ params }: ProfilePageProps) => {
  const { locale } = await params;

  if (!isSupportedLocale(locale)) {
    notFound();
  }

  const dictionary = getDictionary(locale);

  return <ProfileScreen locale={locale} dictionary={dictionary} />;
};

export default ProfilePage;
