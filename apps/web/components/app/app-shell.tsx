'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { AppAvatarMenu } from './app-avatar-menu';
import { AppSidebar } from './app-sidebar';

import { useAuth } from '@/components/auth/auth-provider';
import { SkeletonAvatar } from '@/components/ui/skeleton';
import { buildLocalePath } from '@/lib/i18n/path';
import type { Dictionary, Locale } from '@/lib/i18n/types';

import './app-shell.css';

type AppShellProps = {
  locale: Locale;
  dictionary: Dictionary;
  children: React.ReactNode;
};

export const AppShell = ({ locale, dictionary, children }: AppShellProps) => {
  const router = useRouter();
  const { authUser, logout, isReady } = useAuth();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const handleLogout = async () => {
    await logout();
    router.replace(buildLocalePath(locale, '/'));
  };

  const role = authUser?.role ?? 'customer';

  return (
    <div className="app-shell">
      <AppSidebar
        locale={locale}
        dictionary={dictionary}
        userRole={role}
        open={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
      />

      <div className="app-shell-main">
        <header className="app-topbar">
          <div className="app-topbar-start">
            <button
              type="button"
              className="app-topbar-hamburger"
              onClick={() => setSidebarOpen(true)}
              aria-label={dictionary.nav.menuOpen}
            >
              &#9776;
            </button>
            <h1 className="app-topbar-title">{dictionary.common.appName}</h1>
          </div>

          <div className="app-topbar-end">
            {isReady && authUser ? (
              <AppAvatarMenu
                locale={locale}
                dictionary={dictionary}
                displayName={authUser.displayName}
                email={authUser.email}
                role={authUser.role}
                onLogout={() => void handleLogout()}
              />
            ) : (
              <SkeletonAvatar size={36} />
            )}
          </div>
        </header>

        {children}
      </div>
    </div>
  );
};
