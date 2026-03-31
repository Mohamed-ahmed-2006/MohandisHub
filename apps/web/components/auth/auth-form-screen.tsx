'use client';

import type { UserRole } from '@mohandishub/shared';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';

import { useAppStatus } from '@/components/app-status-provider';
import { AuthForm } from '@/components/auth/auth-form';
import type { AuthMode } from '@/components/auth/auth-mode-switch';
import { AuthModeSwitch } from '@/components/auth/auth-mode-switch';
import { LanguageToggle } from '@/components/language-toggle';
import { OnboardingStepper } from '@/components/onboarding/onboarding-stepper';
import { SiteLogo } from '@/components/site-logo';
import { ThemeToggle } from '@/components/theme-toggle';
import { Container } from '@/components/ui/container';
import { buildLocalePath } from '@/lib/i18n/path';
import type { Dictionary, Locale } from '@/lib/i18n/types';

type RegisterRole = Exclude<UserRole, 'admin'>;

type RegisterStep = 'role' | 'form';

type AuthFormScreenProps = {
  locale: Locale;
  dictionary: Dictionary;
  initialMode: AuthMode;
  initialRole: RegisterRole;
};

const resolveMode = (value: string | null): AuthMode => {
  return value === 'register' ? 'register' : 'login';
};

const resolveRole = (value: string | null): RegisterRole => {
  if (
    value === 'expert' ||
    value === 'craftsman' ||
    value === 'business' ||
    value === 'customer'
  ) {
    return value;
  }

  return 'customer';
};

const roleOptions: RegisterRole[] = ['customer', 'expert', 'craftsman', 'business'];

export const AuthFormScreen = ({
  locale,
  dictionary,
  initialMode,
  initialRole,
}: AuthFormScreenProps) => {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const { status } = useAppStatus();
  const [mode, setMode] = useState<AuthMode>(initialMode);
  const [role, setRole] = useState<RegisterRole>(initialRole);
  const [registerStep, setRegisterStep] = useState<RegisterStep>(
    initialMode === 'register' ? 'role' : 'form',
  );

  const signupsLocked = status?.signupsLocked === true;
  const isRtl = locale === 'ar';

  useEffect(() => {
    const nextMode = resolveMode(searchParams.get('mode'));
    const nextRole = resolveRole(searchParams.get('role'));
    const hasRoleInUrl = searchParams.get('role') != null && searchParams.get('role') !== '';

    setMode(nextMode);
    setRole(nextRole);

    if (nextMode === 'register') {
      setRegisterStep(hasRoleInUrl ? 'form' : 'role');
    } else {
      setRegisterStep('form');
    }
  }, [searchParams]);

  const syncQueryState = (
    nextMode: AuthMode,
    nextRole: RegisterRole,
    includeRegisterRole = true,
  ): void => {
    const query = new URLSearchParams();
    query.set('mode', nextMode);

    if (nextMode === 'register' && includeRegisterRole) {
      query.set('role', nextRole);
    }

    const targetPath = `${pathname}?${query.toString()}`;
    router.replace(targetPath, { scroll: false });
  };

  const handleModeChange = (nextMode: AuthMode): void => {
    setMode(nextMode);
    if (nextMode === 'register') {
      setRegisterStep('role');
    } else {
      setRegisterStep('form');
    }
    syncQueryState(nextMode, role, nextMode !== 'register');
  };

  const handleRoleCardSelect = (selectedRole: RegisterRole): void => {
    setRole(selectedRole);
    setRegisterStep('form');
    syncQueryState('register', selectedRole);
  };

  const handleBackToRoleStep = (): void => {
    setRegisterStep('role');
  };

  const handleRoleChange = (nextRole: RegisterRole): void => {
    setRole(nextRole);
    syncQueryState(mode, nextRole);
  };

  const backToHomePath = useMemo(() => buildLocalePath(locale, '/'), [locale]);

  const authRegisterSteps = [
    dictionary.auth.register.stepChooseRole,
    dictionary.auth.register.stepAccountDetails,
  ];

  return (
    <main className="auth-page-main" suppressHydrationWarning>
      <Container className="auth-page-container">
        <header className="auth-page-header">
          <Link href={backToHomePath} className="auth-page-brand-link">
            <SiteLogo />
          </Link>
          <div className="auth-page-header-actions">
            <LanguageToggle
              locale={locale}
              targetLabel={dictionary.language.target}
              ariaLabel={dictionary.language.switchLabel}
            />
            <ThemeToggle
              switchToLightLabel={dictionary.theme.switchToLight}
              switchToDarkLabel={dictionary.theme.switchToDark}
              darkLabel={dictionary.theme.darkLabel}
              lightLabel={dictionary.theme.lightLabel}
            />
          </div>
        </header>

        <div className="auth-page-layout">
          <aside className="auth-page-banner" aria-hidden="true">
            <h2 className="auth-page-banner-title">
              {mode === 'login'
                ? dictionary.auth.login.title
                : dictionary.auth.register.chooseRoleTitle}
            </h2>
            <p className="auth-page-banner-text">
              {mode === 'login'
                ? dictionary.auth.login.subtitle
                : dictionary.auth.register.chooseRoleSubtitle}
            </p>
          </aside>

          <div className="auth-page-content">
            {mode === 'register' && signupsLocked ? (
              <section className="auth-form-shell" aria-live="polite">
                <AuthModeSwitch
                  mode={mode}
                  loginLabel={dictionary.auth.common.login}
                  registerLabel={dictionary.auth.common.register}
                  onModeChange={handleModeChange}
                />
                <div className="auth-form-header" style={{ textAlign: 'center', padding: '2rem 0' }}>
                  <h1 className="auth-form-title">Sign-ups Closed</h1>
                  <p className="auth-form-subtitle">
                    New registrations are currently disabled. Please check back later or try logging in
                    if you already have an account.
                  </p>
                  <button
                    type="button"
                    className="auth-form-footer-link-button"
                    onClick={() => handleModeChange('login')}
                    style={{ marginTop: '1rem' }}
                  >
                    {dictionary.auth.common.switchToLogin}
                  </button>
                </div>
              </section>
            ) : mode === 'register' && registerStep === 'role' ? (
              <section className="auth-form-shell" aria-live="polite">
                <AuthModeSwitch
                  mode={mode}
                  loginLabel={dictionary.auth.common.login}
                  registerLabel={dictionary.auth.common.register}
                  onModeChange={handleModeChange}
                />

                <header className="auth-form-header">
                  <h1 className="auth-form-title">{dictionary.auth.register.chooseRoleTitle}</h1>
                  <p className="auth-form-subtitle">{dictionary.auth.register.chooseRoleSubtitle}</p>
                </header>

                <div className="auth-role-cards">
                  {roleOptions.map((r) => (
                    <button
                      key={r}
                      type="button"
                      className="auth-role-card"
                      onClick={() => handleRoleCardSelect(r)}
                    >
                      <div className="auth-role-card-body">
                        <span className="auth-role-card-title">{dictionary.auth.roles[r]}</span>
                        <p className="auth-role-card-description">
                          {dictionary.onboarding.role.cards[r].description}
                        </p>
                      </div>
                      <span className="auth-role-card-arrow" aria-hidden="true">
                        {isRtl ? '\u2190' : '\u2192'}
                      </span>
                    </button>
                  ))}
                </div>

                <footer className="auth-form-footer">
                  <p className="auth-form-footer-text">{dictionary.auth.common.haveAccount}</p>
                  <button
                    type="button"
                    className="auth-form-footer-link-button"
                    onClick={() => handleModeChange('login')}
                  >
                    {dictionary.auth.common.switchToLogin}
                  </button>
                </footer>
              </section>
            ) : (
              <AuthForm
                locale={locale}
                mode={mode}
                role={role}
                dictionary={dictionary.auth}
                registerSteps={authRegisterSteps}
                stepLabel={dictionary.common.step}
                ofLabel={dictionary.common.of}
                backLabel={dictionary.common.back}
                onModeChange={handleModeChange}
                onRoleChange={handleRoleChange}
                {...(mode === 'register' ? { onBackToRoleSelect: handleBackToRoleStep } : {})}
              />
            )}
          </div>
        </div>
      </Container>
    </main>
  );
};
