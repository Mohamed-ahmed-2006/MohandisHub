'use client';

import type { ServicesCatalogResponse, UserRole } from '@mohandishub/shared';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';

import { RoleSuggestions } from '@/components/app/role-suggestions';
import { ServiceSelector } from '@/components/app/service-selector';
import { TopBar } from '@/components/app/top-bar';
import { useAuth } from '@/components/auth/auth-provider';
import { buildLocalePath } from '@/lib/i18n/path';
import type { Dictionary, Locale } from '@/lib/i18n/types';
import { loadCatalogForRole } from '@/lib/services/catalog';

type SecondHomeShellProps = {
  locale: Locale;
  dictionary: Dictionary;
};

const emptyCatalog: ServicesCatalogResponse = {
  categories: [],
  services: [],
};

export const SecondHomeShell = ({ locale, dictionary }: SecondHomeShellProps) => {
  const router = useRouter();
  const { authUser, accessToken, isAuthenticated, isReady, logout } = useAuth();
  const [catalog, setCatalog] = useState<ServicesCatalogResponse>(emptyCatalog);
  const [fallbackUsed, setFallbackUsed] = useState(false);

  const role = authUser?.role ?? null;

  useEffect(() => {
    if (isReady && !isAuthenticated) {
      router.replace(`${buildLocalePath(locale, '/auth')}?mode=login`);
    }
  }, [isAuthenticated, isReady, locale, router]);

  useEffect(() => {
    if (!authUser?.role) {
      return;
    }

    let cancelled = false;
    void (async () => {
      const loaded = await loadCatalogForRole(authUser.role, accessToken);
      if (!cancelled) {
        setCatalog(loaded.catalog);
        setFallbackUsed(loaded.fallbackUsed);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [accessToken, authUser?.role]);

  const roleDescription = useMemo(() => {
    if (!role) {
      return dictionary.appHome.genericRoleDescription;
    }

    return dictionary.appHome.roleDescriptions[role];
  }, [dictionary.appHome.genericRoleDescription, dictionary.appHome.roleDescriptions, role]);

  const roleLabel =
    role === 'customer' || role === 'expert' || role === 'business' ? dictionary.auth.roles[role] : 'Admin';

  if (!isReady || !isAuthenticated || !authUser) {
    return <p className="app-home-loading">{dictionary.appHome.loading}</p>;
  }

  return (
    <div className="app-home-shell">
      <TopBar
        appName={dictionary.common.appName}
        role={authUser.role}
        roleTitle={roleLabel}
        dictionary={dictionary.appHome}
        onLogout={async () => {
          await logout();
          router.replace(`${buildLocalePath(locale, '/auth')}?mode=login`);
        }}
      />

      <section className="app-home-card">
        <h1 className="app-home-welcome">
          {dictionary.appHome.welcome}, {authUser.displayName}
        </h1>
        <p className="app-home-description">{roleDescription}</p>
      </section>

      <div className="app-home-grid">
        <RoleSuggestions role={role as UserRole | null} dictionary={dictionary.appHome.suggestions} />
        <ServiceSelector
          role={authUser.role}
          catalog={catalog}
          fallbackUsed={fallbackUsed}
          dictionary={dictionary.appHome}
        />
      </div>

      <section className="app-home-card">
        <h2 className="app-home-section-title">{dictionary.appHome.settings}</h2>
        <div className="app-home-links">
          <Link href={buildLocalePath(locale, '/profile')} className="app-home-link">
            {dictionary.appHome.profile}
          </Link>
          <Link href={buildLocalePath(locale, '/settings')} className="app-home-link">
            {dictionary.appHome.settings}
          </Link>
          <Link href={buildLocalePath(locale, '/help')} className="app-home-link">
            {dictionary.appHome.helpSupport}
          </Link>
        </div>
      </section>
    </div>
  );
};
