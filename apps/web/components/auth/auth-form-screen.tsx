'use client';

import type { UserRole } from '@mohandishub/shared';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';

import { AuthForm } from '@/components/auth/auth-form';
import type { AuthMode } from '@/components/auth/auth-mode-switch';
import { LanguageToggle } from '@/components/language-toggle';
import { SiteLogo } from '@/components/site-logo';
import { ThemeToggle } from '@/components/theme-toggle';
import { Container } from '@/components/ui/container';
import { buildLocalePath } from '@/lib/i18n/path';
import type { Dictionary, Locale } from '@/lib/i18n/types';

type RegisterRole = Exclude<UserRole, 'admin'>;

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
  if (value === 'expert' || value === 'business' || value === 'customer') {
    return value;
  }

  return 'customer';
};

export const AuthFormScreen = ({
  locale,
  dictionary,
  initialMode,
  initialRole,
}: AuthFormScreenProps) => {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const [mode, setMode] = useState<AuthMode>(initialMode);
  const [role, setRole] = useState<RegisterRole>(initialRole);

  useEffect(() => {
    const nextMode = resolveMode(searchParams.get('mode'));
    const nextRole = resolveRole(searchParams.get('role'));

    setMode(nextMode);
    setRole(nextRole);
  }, [searchParams]);

  const syncQueryState = (nextMode: AuthMode, nextRole: RegisterRole): void => {
    const query = new URLSearchParams();
    query.set('mode', nextMode);

    if (nextMode === 'register') {
      query.set('role', nextRole);
    }

    const targetPath = `${pathname}?${query.toString()}`;
    router.replace(targetPath, { scroll: false });
  };

  const handleModeChange = (nextMode: AuthMode): void => {
    setMode(nextMode);
    syncQueryState(nextMode, role);
  };

  const handleRoleChange = (nextRole: RegisterRole): void => {
    setRole(nextRole);
    syncQueryState(mode, nextRole);
  };

  const backToHomePath = useMemo(() => buildLocalePath(locale, '/'), [locale]);

  return (
    <main className="auth-page-main">
      <div className="auth-page-floating-controls">
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

      <Container className="auth-page-container">
        <header className="auth-page-header">
          <Link href={backToHomePath} className="auth-page-brand-link">
            <SiteLogo />
          </Link>
        </header>

        <AuthForm
          locale={locale}
          mode={mode}
          role={role}
          dictionary={dictionary.auth}
          onModeChange={handleModeChange}
          onRoleChange={handleRoleChange}
        />
      </Container>
    </main>
  );
};
