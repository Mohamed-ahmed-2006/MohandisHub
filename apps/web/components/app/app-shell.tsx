'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

import { AppAvatarMenu } from './app-avatar-menu';
import { AppSidebar } from './app-sidebar';
import { WalletDepositModal } from './wallet-deposit-modal';

import { useAuth } from '@/components/auth/auth-provider';
import { SkeletonAvatar } from '@/components/ui/skeleton';
import { buildLocalePath } from '@/lib/i18n/path';
import type { Dictionary, Locale } from '@/lib/i18n/types';
import { walletApiClient } from '@/lib/wallet/client';

import './app-shell.css';

type AppShellProps = {
  locale: Locale;
  dictionary: Dictionary;
  children: React.ReactNode;
};

export const AppShell = ({ locale, dictionary, children }: AppShellProps) => {
  const router = useRouter();
  const { authUser, accessToken, logout, isReady } = useAuth();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [wallet, setWallet] = useState<{ balance: number; currency: string } | null>(null);
  const [showDeposit, setShowDeposit] = useState(false);

  useEffect(() => {
    if (!isReady || !accessToken) return;
    void walletApiClient
      .getMyWallet(accessToken)
      .then((w) => setWallet(w))
      .catch(() => setWallet(null));
  }, [isReady, accessToken]);

  useEffect(() => {
    if (!isReady || !accessToken) return;
    const onVisible = () => {
      void walletApiClient
        .getMyWallet(accessToken)
        .then((w) => setWallet(w))
        .catch(() => setWallet(null));
    };
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') onVisible();
    });
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [isReady, accessToken]);

  useEffect(() => {
    if (!isReady || !accessToken) return;
    const handler = () => {
      void walletApiClient
        .getMyWallet(accessToken)
        .then((w) => setWallet(w))
        .catch(() => setWallet(null));
    };
    window.addEventListener('wallet-updated', handler);
    return () => window.removeEventListener('wallet-updated', handler);
  }, [isReady, accessToken]);

  const handleLogout = async () => {
    await logout();
    router.replace(buildLocalePath(locale, '/'));
  };

  const role: string = authUser?.role ?? 'customer';
  const isAdmin: boolean = authUser?.isAdmin === true;

  return (
    <div className="app-shell">
      <AppSidebar
        locale={locale}
        dictionary={dictionary}
        userRole={role}
        isAdmin={isAdmin}
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
              <>
                {(wallet != null || accessToken) && (
                  <div className="app-topbar-balance">
                    <span className="app-topbar-balance-label">{dictionary.wallet.balance}</span>
                    <span className="app-topbar-balance-amount">
                      {wallet != null
                        ? `${wallet.balance.toFixed(2)} ${wallet.currency}`
                        : '—'}
                    </span>
                    <button
                      type="button"
                      className="app-topbar-balance-refresh"
                      onClick={() => {
                        if (accessToken)
                          void walletApiClient
                            .getMyWallet(accessToken)
                            .then((w) => setWallet(w))
                            .catch(() => setWallet(null));
                      }}
                      aria-label="Refresh balance"
                    >
                      ↻
                    </button>
                    <button
                      type="button"
                      className="app-topbar-balance-add"
                      onClick={() => setShowDeposit(true)}
                      aria-label={dictionary.wallet.deposit}
                    >
                      +
                    </button>
                  </div>
                )}
                <AppAvatarMenu
                  locale={locale}
                  dictionary={dictionary}
                  displayName={authUser.displayName}
                  email={authUser.email}
                  role={authUser.role}
                  onLogout={() => void handleLogout()}
                />
              </>
            ) : (
              <SkeletonAvatar size={36} />
            )}
          </div>
        </header>

        {children}

        {showDeposit && accessToken && (
          <WalletDepositModal
            dictionary={dictionary}
            accessToken={accessToken}
            onClose={() => setShowDeposit(false)}
            onDepositCreated={() => {
              if (accessToken)
                void walletApiClient
                  .getMyWallet(accessToken)
                  .then((w) => setWallet(w))
                  .catch(() => {});
            }}
          />
        )}
      </div>
    </div>
  );
};
