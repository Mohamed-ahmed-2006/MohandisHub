'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

import { useAuth } from '@/components/auth/auth-provider';
import { SiteLogo } from '@/components/site-logo';
import { Container } from '@/components/ui/container';
import { buildLocalePath } from '@/lib/i18n/path';
import type { Dictionary, Locale } from '@/lib/i18n/types';

type Props = { locale: Locale; dictionary: Dictionary };

export const CustomerOnboardingScreen = ({ locale, dictionary }: Props) => {
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

  if (!isReady || !authUser) {
    return (
      <main className="customer-onboarding-page-main">
        <Container>
          <p className="onboarding-loading">{dictionary.appHome.loading}</p>
        </Container>
      </main>
    );
  }

  return (
    <main className="customer-onboarding-page-main">
      <Container>
        <header className="onboarding-header">
          <Link href={buildLocalePath(locale, '/')} className="onboarding-brand">
            <SiteLogo />
          </Link>
        </header>

        <section className="onboarding-card">
          <h1 className="onboarding-title">{dictionary.onboarding.customer.title}</h1>
          <p className="onboarding-description">{dictionary.onboarding.customer.welcomeMessage}</p>

          <Link href={buildLocalePath(locale, '/app')} className="onboarding-cta-button">
            {dictionary.onboarding.customer.goToDashboard}
          </Link>
        </section>
      </Container>
    </main>
  );
};
