'use client';

import { useEffect, useState } from 'react';

import { AUTH_SESSION_HINT_KEY, useAuth } from '@/components/auth/auth-provider';
import { ButtonLink } from '@/components/ui/button-link';
import { buildLocalePath } from '@/lib/i18n/path';
import type { Dictionary, Locale } from '@/lib/i18n/types';

type BaseProps = {
  locale: Locale;
  dictionary: Dictionary;
};

/** Navbar/hero use `common.goToDashboard`; keep fallbacks for older bundles or partial dictionaries. */
function goToDashboardLabel(dictionary: Dictionary, locale: Locale): string {
  const fromCommon = dictionary.common?.goToDashboard;
  if (typeof fromCommon === 'string' && fromCommon.trim() !== '') return fromCommon;
  const fromOnboarding = dictionary.onboarding?.customer?.goToDashboard;
  if (typeof fromOnboarding === 'string' && fromOnboarding.trim() !== '') return fromOnboarding;
  return locale === 'ar' ? 'الذهاب إلى لوحة التحكم' : 'Go to dashboard';
}

const guestNav = (locale: Locale, dictionary: Dictionary) => (
  <>
    <ButtonLink
      href={`${buildLocalePath(locale, '/auth')}?mode=login`}
      label={dictionary.common.login}
      variant="secondary"
    />
    <ButtonLink
      href={`${buildLocalePath(locale, '/auth')}?mode=register`}
      label={dictionary.common.signUp}
    />
  </>
);

/**
 * Navbar auth actions on the marketing home: after session restore, show dashboard instead of login/sign up.
 */
export function HomePageNavAuth({ locale, dictionary }: BaseProps) {
  const { isAuthenticated, isReady } = useAuth();
  const [mounted, setMounted] = useState(false);
  const [hadSessionHint, setHadSessionHint] = useState(false);

  useEffect(() => {
    setMounted(true);
    setHadSessionHint(window.localStorage.getItem(AUTH_SESSION_HINT_KEY) === '1');
  }, []);

  const appHref = buildLocalePath(locale, '/app');
  const restoring = mounted && hadSessionHint && !isReady;

  if (!mounted || restoring) {
    return (
      <nav className="home-page-nav-actions" aria-busy={restoring}>
        {restoring ? (
          <span className="home-page-session-restoring">{dictionary.auth.common.sessionRestoring}</span>
        ) : (
          guestNav(locale, dictionary)
        )}
      </nav>
    );
  }

  if (isAuthenticated) {
    return (
      <nav className="home-page-nav-actions">
        <ButtonLink href={appHref} label={goToDashboardLabel(dictionary, locale)} />
      </nav>
    );
  }

  return <nav className="home-page-nav-actions">{guestNav(locale, dictionary)}</nav>;
}

/**
 * Hero primary CTA: dashboard when signed in, otherwise get started → register.
 */
export function HomePageHeroCta({ locale, dictionary }: BaseProps) {
  const { isAuthenticated, isReady } = useAuth();
  const [mounted, setMounted] = useState(false);
  const [hadSessionHint, setHadSessionHint] = useState(false);

  useEffect(() => {
    setMounted(true);
    setHadSessionHint(window.localStorage.getItem(AUTH_SESSION_HINT_KEY) === '1');
  }, []);

  const appHref = buildLocalePath(locale, '/app');
  const registerHref = `${buildLocalePath(locale, '/auth')}?mode=register`;
  const restoring = mounted && hadSessionHint && !isReady;

  if (!mounted || restoring) {
    return (
      <div className="home-page-hero-actions">
        {restoring ? (
          <p className="home-page-session-restoring home-page-hero-restoring">
            {dictionary.auth.common.sessionRestoring}
          </p>
        ) : (
          <ButtonLink
            href={registerHref}
            label={dictionary.common.getStarted}
            className="home-page-hero-cta-button"
          />
        )}
      </div>
    );
  }

  return (
    <div className="home-page-hero-actions">
      <ButtonLink
        href={isAuthenticated ? appHref : registerHref}
        label={
          isAuthenticated ? goToDashboardLabel(dictionary, locale) : dictionary.common.getStarted
        }
        className="home-page-hero-cta-button"
      />
    </div>
  );
}

/** Hides “join as role” cards when the user already has a session (avoids pushing them to register again). */
export function HomePageJoinSectionGate({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, isReady } = useAuth();
  const [mounted, setMounted] = useState(false);
  const [hadSessionHint, setHadSessionHint] = useState(false);

  useEffect(() => {
    setMounted(true);
    setHadSessionHint(window.localStorage.getItem(AUTH_SESSION_HINT_KEY) === '1');
  }, []);

  const restoring = mounted && hadSessionHint && !isReady;
  if (!mounted || restoring) {
    return <>{children}</>;
  }
  if (isAuthenticated) {
    return null;
  }
  return <>{children}</>;
}
