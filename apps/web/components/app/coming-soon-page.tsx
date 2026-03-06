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

  return (
    <main style={{ minHeight: '100vh', paddingBlock: '2rem' }}>
      <Container className="profile-screen-container">
        <section
          style={{
            padding: '2rem',
            borderRadius: '1rem',
            border: '1px solid hsl(var(--border))',
            backgroundColor: 'hsl(var(--card))',
            textAlign: 'center',
          }}
        >
          <h1
            style={{
              margin: '0 0 0.75rem',
              fontSize: '1.5rem',
              fontWeight: 700,
              color: 'hsl(var(--foreground))',
            }}
          >
            {title}
          </h1>
          <p style={{ margin: 0, color: 'hsl(var(--text-soft))', fontSize: '1rem' }}>
            {dictionary.common.comingSoon}
          </p>
        </section>
      </Container>
    </main>
  );
};
