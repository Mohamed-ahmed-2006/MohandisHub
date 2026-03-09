'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';

import { AppAvatarMenu } from './app-avatar-menu';
import { AppSidebar } from './app-sidebar';
import { ToastProvider, useToast } from './toast';
import { WalletDepositModal } from './wallet-deposit-modal';

import { useAuth } from '@/components/auth/auth-provider';
import { SkeletonAvatar } from '@/components/ui/skeleton';
import { getChatSocket } from '@/lib/chat/socket';
import { buildLocalePath } from '@/lib/i18n/path';
import type { Dictionary, Locale } from '@/lib/i18n/types';
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

  const { authUser, accessToken, logout, isReady } = useAuth();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [wallet, setWallet] = useState<{ balance: number; currency: string } | null>(null);
  const [showDeposit, setShowDeposit] = useState(false);
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

  const searchParams = useSearchParams();
  const [stripeMessage, setStripeMessage] = useState<'success' | 'cancelled' | null>(null);

  useEffect(() => {
    const timer = setTimeout(() => {
      const urlParams = new URLSearchParams(window.location.search);
      const stripe = searchParams.get('stripe') || urlParams.get('stripe');
      const sessionId = searchParams.get('session_id') || urlParams.get('session_id');
      
      if (stripe === 'success' || stripe === 'cancelled') {
        setStripeMessage(stripe);
        const intervalRef: { current: ReturnType<typeof setInterval> | null } = { current: null };
        if (stripe === 'success' && accessToken) {
          void (async () => {
            if (sessionId) {
              try {
                await walletApiClient.confirmStripeSession(accessToken, sessionId);
              } catch {
                void 0;
              }
            }
            try {
              await walletApiClient.getMyWallet(accessToken);
              window.dispatchEvent(new CustomEvent('wallet-updated'));
            } catch {
              void 0;
            }
            const maxAttempts = 30;
            let attempts = 0;
            intervalRef.current = setInterval(() => {
              attempts += 1;
              if (attempts > maxAttempts && intervalRef.current) {
                clearInterval(intervalRef.current);
                intervalRef.current = null;
                return;
              }
              window.dispatchEvent(new CustomEvent('wallet-updated'));
            }, 2000);
            
            const url = new URL(window.location.href);
            if (url.searchParams.get('stripe') === 'success' || url.searchParams.has('session_id')) {
              url.searchParams.delete('stripe');
              url.searchParams.delete('session_id');
              window.history.replaceState({}, '', url.pathname + url.search);
            }
          })();
        } else if (stripe === 'cancelled') {
          setTimeout(() => {
            const url = new URL(window.location.href);
            url.searchParams.delete('stripe');
            url.searchParams.delete('session_id');
            window.history.replaceState({}, '', url.pathname + url.search);
          }, 500);
        }
      }
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

        {stripeMessage && (
          <div style={{ position: 'fixed', bottom: '20px', right: '20px', zIndex: 9999, background: stripeMessage === 'success' ? '#10b981' : '#ef4444', color: 'white', padding: '16px', borderRadius: '8px', boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)' }} role="alert">
            {stripeMessage === 'success'
              ? (dictionary.wallet?.depositSuccess ?? 'Deposit successful. Your balance has been updated.')
              : (dictionary.wallet?.depositCancelled ?? 'Deposit was cancelled.')}
            <button
              type="button"
              style={{ marginLeft: '12px', background: 'transparent', border: 'none', color: 'white', cursor: 'pointer', fontWeight: 'bold' }}
              onClick={() => setStripeMessage(null)}
              aria-label="Dismiss"
            >
              ×
            </button>
          </div>
        )}

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
