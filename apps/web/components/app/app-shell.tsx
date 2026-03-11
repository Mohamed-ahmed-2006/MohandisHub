'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';

import { AppAvatarMenu } from './app-avatar-menu';
import { AppSidebar } from './app-sidebar';
import { ToastProvider, useToast } from './toast';
import { useAuth } from '@/components/auth/auth-provider';
import { SkeletonAvatar } from '@/components/ui/skeleton';
import { getChatSocket } from '@/lib/chat/socket';
import { buildLocalePath } from '@/lib/i18n/path';
import type { Dictionary, Locale } from '@/lib/i18n/types';
import { profilesApiClient } from '@/lib/profiles/client';
import { walletApiClient } from '@/lib/wallet/client';

import './app-shell.css';

type AppShellProps = {
  locale: Locale;
  dictionary: Dictionary;
  children: React.ReactNode;
};

type AppNotification = {
  type: string;
  title: string;
  message: string;
  [key: string]: unknown;
};

export const AppShell = (props: AppShellProps) => {
  return (
    <ToastProvider>
      <AppShellInner {...props} />
    </ToastProvider>
  );
};

const AppShellInner = ({ locale, dictionary, children }: AppShellProps) => {
  const router = useRouter();
  const searchParams = useSearchParams();

  const { authUser, accessToken, logout, isReady } = useAuth();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [wallet, setWallet] = useState<{ balance: number; currency: string } | null>(null);
  const [depositMessage, setDepositMessage] = useState<'success' | 'cancelled' | null>(null);
  const { addToast } = useToast();

  useEffect(() => {
    if (!isReady || !accessToken) return;
    void walletApiClient
      .getMyWallet(accessToken)
      .then((w) => setWallet(w))
      .catch(() => setWallet(null));
  }, [isReady, accessToken]);

  useEffect(() => {
    if (!isReady || !authUser || !accessToken) return;
    const role = authUser.role;
    if (role !== 'expert' && role !== 'business') return;
    const verificationStatus = authUser.verificationStatus;
    const onboardingPath = role === 'expert' ? '/onboarding/expert' : '/onboarding/business';
    void (async () => {
      try {
        if (role === 'expert') {
          await profilesApiClient.getExpertProfile(accessToken);
        } else {
          await profilesApiClient.getBusinessProfile(accessToken);
        }
        if (verificationStatus && verificationStatus !== 'verified') {
          router.replace(buildLocalePath(locale, onboardingPath));
          return;
        }
      } catch {
        router.replace(buildLocalePath(locale, onboardingPath));
      }
    })();
  }, [isReady, authUser, accessToken, locale, router]);

  useEffect(() => {
    if (!isReady || !authUser || !accessToken) return;
    const sock = getChatSocket(accessToken);
    if (!sock) return;

    sock.emit('join_user', { userId: authUser.id });

    const onNotification = (data: AppNotification) => {
      addToast(data.title, data.message);
    };

    sock.on('notification', onNotification);
    return () => {
      sock.off('notification', onNotification);
    };
  }, [isReady, authUser, accessToken, addToast]);

  useEffect(() => {
    if (!isReady || !accessToken) return;
    const onVisible = () => {
      void walletApiClient
        .getMyWallet(accessToken)
        .then((w) => setWallet(w))
        .catch(() => setWallet(null));
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') onVisible();
    };
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => document.removeEventListener('visibilitychange', onVisibilityChange);
  }, [isReady, accessToken]);

  useEffect(() => {
    const timer = setTimeout(() => {
      const urlParams = new URLSearchParams(window.location.search);
      const deposit = searchParams.get('deposit') || urlParams.get('deposit');
      if (deposit !== 'success' && deposit !== 'cancelled') return;

      setDepositMessage(deposit);
      if (deposit === 'success' && accessToken) {
        const maxAttempts = 20;
        let attempts = 0;
        const pollInterval = setInterval(() => {
          attempts += 1;
          if (attempts > maxAttempts) {
            clearInterval(pollInterval);
            return;
          }
          window.dispatchEvent(new CustomEvent('wallet-updated'));
        }, 2000);
      }

      const url = new URL(window.location.href);
      url.searchParams.delete('deposit');
      url.searchParams.delete('order_id');
      window.history.replaceState({}, '', url.pathname + url.search);
    }, 100);

    return () => clearTimeout(timer);
  }, [searchParams, accessToken]);

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
        accessToken={accessToken ?? undefined}
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
                  <button
                    type="button"
                    className="app-topbar-balance app-topbar-balance-link"
                    onClick={() => router.push(buildLocalePath(locale, '/app/settings/wallet'))}
                    aria-label="Open wallet settings"
                  >
                    <span className="app-topbar-balance-label">{dictionary.wallet.balance}</span>
                    <span className="app-topbar-balance-amount">
                      {wallet != null ? `${wallet.balance.toFixed(2)} ${wallet.currency}` : '-'}
                    </span>
                  </button>
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

        {depositMessage && (
          <div
            style={{
              position: 'fixed',
              bottom: '20px',
              right: '20px',
              zIndex: 9999,
              background: depositMessage === 'success' ? '#10b981' : '#ef4444',
              color: 'white',
              padding: '16px',
              borderRadius: '8px',
              boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)',
            }}
            role="alert"
          >
            {depositMessage === 'success'
              ? (dictionary.wallet?.depositSuccess ??
                'Deposit successful. Your balance will update after confirmation.')
              : (dictionary.wallet?.depositCancelled ?? 'Deposit was cancelled.')}
            <button
              type="button"
              style={{
                marginLeft: '12px',
                background: 'transparent',
                border: 'none',
                color: 'white',
                cursor: 'pointer',
                fontWeight: 'bold',
              }}
              onClick={() => setDepositMessage(null)}
              aria-label="Dismiss"
            >
              x
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
