'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

import { BusinessJobsTab } from './business-jobs-tab';
import { ExpertJobsTab } from './expert-jobs-tab';

import { useAuth } from '@/components/auth/auth-provider';
import { buildLocalePath } from '@/lib/i18n/path';
import type { Dictionary, Locale } from '@/lib/i18n/types';

type Props = {
  locale: Locale;
  dictionary: Dictionary;
};

export const ProjectsScreen = ({ locale, dictionary }: Props) => {
  const router = useRouter();
  const { authUser, accessToken, isAuthenticated, isReady, authGuard } = useAuth();

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

  if (!isReady || !authUser || !accessToken || !authGuard.emailVerified) {
    return <p className="dashboard-loading">{dictionary.auth.common.loading}</p>;
  }

  if (authUser.role === 'business') {
    return <BusinessJobsTab accessToken={accessToken} dictionary={dictionary} />;
  }

  if (authUser.role === 'expert' || authUser.role === 'craftsman') {
    return <ExpertJobsTab accessToken={accessToken} dictionary={dictionary} />;
  }

  return (
    <section className="dashboard-section">
      <h2 className="dashboard-section-title">{dictionary.nav.projects}</h2>
      <p className="dashboard-empty">
        {locale === 'ar'
          ? 'مساحة الوظائف متاحة حالياً للشركات ومقدمي الخدمات.'
          : 'The jobs workspace is available for businesses and providers.'}
      </p>
    </section>
  );
};
