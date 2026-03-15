'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';

import { AppAvatarMenu } from './app-avatar-menu';
import { AppSidebar } from './app-sidebar';
import { NotificationCenter } from './notification-center';
import { ProfileModalProvider, useProfileModal } from './profile-modal-context';
import { ToastProvider, useToast } from './toast';
import { UserProfileModal } from './user-profile-modal';
import { WalletDepositModal } from './wallet-deposit-modal';

import { useAuth } from '@/components/auth/auth-provider';
import { SkeletonAvatar } from '@/components/ui/skeleton';
import { getChatSocket } from '@/lib/chat/socket';
import { useWallet } from '@/lib/hooks/use-api-swr';
import { useI18n } from '@/lib/i18n/context';
import { buildLocalePath } from '@/lib/i18n/path';
import { profilesApiClient } from '@/lib/profiles/client';

import './app-shell.css';

type AppShellProps = {
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
      <ProfileModalProvider>
        <AppShellInner {...props} />
      </ProfileModalProvider>
    </ToastProvider>
  );
};

const AppShellInner = ({ children }: AppShellProps) => {
  const { locale, dictionary } = useI18n();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { profileModalUserId, profileModalInitialData, closeProfileModal } = useProfileModal();

  const { authUser, accessToken, logout, isReady } = useAuth();
  const { wallet, mutate: mutateWallet } = useWallet(isReady && accessToken ? accessToken : null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [showDepositModal, setShowDepositModal] = useState(false);
  const [depositMessage, setDepositMessage] = useState<'success' | 'cancelled' | null>(null);
  const { addToast } = useToast();

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
    let cancelled = false;
    void getChatSocket(accessToken).then((sock) => {
      if (cancelled || !sock) return;
      sock.emit('join_user', { userId: authUser.id });
      const onNotification = (data: AppNotification) => {
        addToast(data.title, data.message);
      };
      sock.on('notification', onNotification);
    });
    return () => {
      cancelled = true;
      void getChatSocket(accessToken).then((sock) => {
        if (sock) sock.off('notification');
      });
    };
  }, [isReady, authUser, accessToken, addToast]);

  useEffect(() => {
    if (!isReady || !accessToken) return;
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') void mutateWallet();
    };
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => document.removeEventListener('visibilitychange', onVisibilityChange);
  }, [isReady, accessToken, mutateWallet]);

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
    const handler = () => void mutateWallet();
    window.addEventListener('wallet-updated', handler);
    return () => window.removeEventListener('wallet-updated', handler);
  }, [isReady, accessToken, mutateWallet]);

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
            {isReady && authUser && accessToken ? (
              <>
                <NotificationCenter accessToken={accessToken} dictionary={dictionary} />
                {(wallet != null || accessToken) && (
                  <div className="app-topbar-balance">
                    <button
                      type="button"
                      className="app-topbar-balance-link app-topbar-balance-main"
                      onClick={() => router.push(buildLocalePath(locale, '/app/settings/wallet'))}
                      aria-label="Open wallet settings"
                    >
                      <span className="app-topbar-balance-label">{dictionary.wallet.balance}</span>
                      <span className="app-topbar-balance-amount">
                        {wallet != null ? `${wallet.balance.toFixed(2)} ${wallet.currency}` : '-'}
                      </span>
                    </button>
                    <button
                      type="button"
                      className="app-topbar-balance-plus"
                      aria-label={dictionary.wallet.deposit}
                      onClick={() => {
                        if (accessToken) setShowDepositModal(true);
                      }}
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

        {showDepositModal && accessToken && (
          <WalletDepositModal
            dictionary={dictionary}
            accessToken={accessToken}
            onClose={() => setShowDepositModal(false)}
            onDepositCreated={() => {
              window.dispatchEvent(new CustomEvent('wallet-updated'));
            }}
          />
        )}

        {profileModalUserId && (
          <UserProfileModal
            userId={profileModalUserId}
            initialData={profileModalInitialData}
            onClose={closeProfileModal}
            locale={locale}
            dictionary={dictionary}
          />
        )}
      </div>
    </div>
  );
};
