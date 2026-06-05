'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

import { useAuth } from '@/components/auth/auth-provider';
import { Container } from '@/components/ui/container';
import { buildLocalePath } from '@/lib/i18n/path';
import type { Dictionary, Locale } from '@/lib/i18n/types';

type ComingSoonPageProps = {
  locale: Locale;
  dictionary: Dictionary;
  title: string;
};

export const ComingSoonPage = ({ locale, dictionary, title }: ComingSoonPageProps) => {
  const router = useRouter();
  const { authUser, isAuthenticated, isReady, authGuard } = useAuth();

  useEffect(() => {
    if (!isReady) return;
    if (!isAuthenticated || !authUser) {
      router.replace(`${buildLocalePath(locale, '/auth')}?mode=login`);
      return;
    }
    if (!authGuard.emailVerified) {
      router.replace(buildLocalePath(locale, '/verify-email'));
    }
  }, [isReady, isAuthenticated, authUser, authGuard.emailVerified, locale, router]);

  // Avoid flashing protected content before the redirect runs.
  if (!isReady || !isAuthenticated || !authUser || !authGuard.emailVerified) {
    return <main className="mh-coming-soon-main" />;
  }

  return (
    <main className="mh-coming-soon-main">
      <Container className="profile-screen-container">
        <section className="mh-coming-soon-card mh-animate-scale-in">
          <h1 className="mh-coming-soon-title">{title}</h1>
          <p className="mh-coming-soon-text">{dictionary.common.comingSoon}</p>
        </section>
      </Container>
    </main>
  );
};
