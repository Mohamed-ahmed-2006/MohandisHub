'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

import { ProviderNegotiationsPanel } from './provider-negotiations-panel';

import { useAuth } from '@/components/auth/auth-provider';
import { Container } from '@/components/ui/container';
import { buildLocalePath } from '@/lib/i18n/path';
import type { Dictionary, Locale } from '@/lib/i18n/types';

import '@/app/dashboard.css';

type Props = {
  locale: Locale;
  dictionary: Dictionary;
};

export function NegotiationsScreen({ locale, dictionary }: Props) {
  const router = useRouter();
  const { authUser, accessToken, isAuthenticated, isReady, authGuard } = useAuth();
  const np = (dictionary as { negotiation?: Record<string, string> }).negotiation ?? {};
  const nav = dictionary.nav ?? {};

  useEffect(() => {
    if (!isReady) return;
    if (!isAuthenticated || !authUser) {
      router.replace(`${buildLocalePath(locale, '/auth')}?mode=login`);
      return;
    }
    if (!authGuard.emailVerified) {
      router.replace(buildLocalePath(locale, '/verify-email'));
      return;
    }
    if (
      authUser.role !== 'expert' &&
      authUser.role !== 'craftsman' &&
      authUser.role !== 'business'
    ) {
      router.replace(buildLocalePath(locale, '/app'));
    }
  }, [isReady, isAuthenticated, authUser, authGuard.emailVerified, locale, router]);

  if (!isReady || !authUser || !accessToken) {
    return (
      <main className="profile-screen-main">
        <Container className="profile-screen-container">
          <p>{dictionary.appHome?.loading ?? 'Loading...'}</p>
        </Container>
      </main>
    );
  }

  return (
    <main className="profile-screen-main">
      <Container className="profile-screen-container">
        <div className="dashboard-section-header">
          <h1 className="dashboard-section-title">
            {np.inboxPageTitle ?? np.providerSectionTitle ?? 'Price negotiations'}
          </h1>
          <Link
            href={buildLocalePath(locale, '/app/services')}
            className="dashboard-link-btn"
          >
            {nav.myServices ?? 'My Services'}
          </Link>
        </div>
        <p className="dashboard-empty" style={{ marginBottom: '1rem', maxWidth: '40rem' }}>
          {np.inboxPageHint ??
            'Respond to customer offers here. This inbox is separate from your service listings.'}
        </p>
        <ProviderNegotiationsPanel
          accessToken={accessToken}
          dictionary={dictionary}
          embedInPage
        />
      </Container>
    </main>
  );
}
