'use client';

import { isProviderRole } from '@mohandishub/shared';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';

import { AppAvatarMenu } from './app-avatar-menu';
import { AppSidebar } from './app-sidebar';
import { NotificationCenter } from './notification-center';
import { ProfileModalProvider, useProfileModal } from './profile-modal-context';
import { SupportFab } from './support-fab';
import { ToastProvider, useToast } from './toast';
import { UserProfileModal } from './user-profile-modal';

import { useAuth } from '@/components/auth/auth-provider';
import { SkeletonAvatar } from '@/components/ui/skeleton';
import { getChatSocket } from '@/lib/chat/socket';
import { useMhcCredits } from '@/lib/hooks/use-api-swr';
import { useI18n } from '@/lib/i18n/context';
import { buildLocalePath } from '@/lib/i18n/path';
import { formatMhc } from '@/lib/mhc/presentation';
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

  const { authUser, accessToken, logout, isReady, refreshSession, isAuthenticated } = useAuth();
  const isProvider = authUser?.role ? isProviderRole(authUser.role) : false;
  const {
    mhcSummary,
    isLoading: isMhcLoading,
    mutate: mutateMhc,
  } = useMhcCredits(isReady && isAuthenticated && accessToken && isProvider ? accessToken : null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [depositMessage, setDepositMessage] = useState<'success' | 'cancelled' | null>(null);
  const { addToast } = useToast();

  useEffect(() => {
    if (!isReady || !authUser || !accessToken) return;
    const role = authUser.role;
    if (role !== 'expert' && role !== 'craftsman' && role !== 'business') return;
    const verificationStatus = authUser.verificationStatus;
    const onboardingPath =
      role === 'expert'
        ? '/onboarding/expert'
        : role === 'craftsman'
          ? '/onboarding/craftsman'
          : '/onboarding/business';
    void (async () => {
      try {
        let profileVerificationStatus: string | null = null;
        if (role === 'expert') {
          const profile = await profilesApiClient.getExpertProfile(accessToken);
          profileVerificationStatus = profile.verificationStatus ?? null;
        } else if (role === 'craftsman') {
          const profile = await profilesApiClient.getCraftsmanProfile(accessToken);
          profileVerificationStatus = profile.verificationStatus ?? null;
        } else {
          const profile = await profilesApiClient.getBusinessProfile(accessToken);
          profileVerificationStatus = profile.verificationStatus ?? null;
        }

        const isVerified =
          verificationStatus === 'verified' || profileVerificationStatus === 'verified';
        if (!isVerified) {
          router.replace(buildLocalePath(locale, onboardingPath));
          return;
        }
      } catch {
        // Avoid forcing verified users back into onboarding on transient API errors.
        if (verificationStatus !== 'verified') {
          router.replace(buildLocalePath(locale, onboardingPath));
        }
      }
    })();
  }, [isReady, authUser, accessToken, router, locale]);

  useEffect(() => {
    let activeSocket: Awaited<ReturnType<typeof getChatSocket>> | null = null;
    if (!isReady || !accessToken) return;

    const onNotification = (data: AppNotification) => {
      const title = data.title || dictionary.common.appName;
      const message = data.message || '';
      addToast(title, message);
    };

    void getChatSocket(accessToken).then((sock) => {
      if (!sock) return;
      activeSocket = sock;
      sock.on('notification', onNotification);
    });

    return () => {
      if (activeSocket) {
        activeSocket.off('notification', onNotification);
      }
    };
  }, [isReady, accessToken, addToast, dictionary.common.appName]);

  useEffect(() => {
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible' && isReady && accessToken) {
        void (async () => {
          await refreshSession();
          void mutateMhc();
        })();
      }
    };
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => document.removeEventListener('visibilitychange', onVisibilityChange);
  }, [isReady, accessToken, mutateMhc, refreshSession]);

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
    const handler = () => void mutateMhc();
    window.addEventListener('wallet-updated', handler);
    return () => window.removeEventListener('wallet-updated', handler);
  }, [isReady, accessToken, mutateMhc]);

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
                <NotificationCenter
                  accessToken={accessToken}
                  dictionary={dictionary}
                  locale={locale}
                  refreshSession={refreshSession}
                  {...(authUser?.role ? { userRole: authUser.role } : {})}
                />
                {isProvider && (
                  <div className="app-topbar-balance">
                    <button
                      type="button"
                      className="app-topbar-balance-link app-topbar-balance-main"
                      onClick={() => router.push(buildLocalePath(locale, '/app/credits'))}
                      aria-label={dictionary.nav?.credits ?? 'MHC Credits'}
                    >
                      <span className="app-topbar-balance-label">MHC</span>
                      <span className="app-topbar-balance-amount">
                        {isMhcLoading
                          ? '-'
                          : mhcSummary != null
                            ? formatMhc(mhcSummary.balance, locale)
                            : '-'}
                      </span>
                    </button>
                  </div>
                )}
                <AppAvatarMenu
                  locale={locale}
                  dictionary={dictionary}
                  displayName={authUser.displayName}
                  email={authUser.email}
                  role={authUser.role}
                  {...(authUser.planProBadge === true ? { planProBadge: true as const } : {})}
                  {...(authUser.planTrustedBusinessBadge === true
                    ? { planTrustedBusinessBadge: true as const }
                    : {})}
                  onLogout={() => void handleLogout()}
                />
              </>
            ) : (
              <SkeletonAvatar size={36} />
            )}
          </div>
        </header>

        {children}

        <SupportFab />

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
              ? (dictionary.wallet?.depositSuccess ?? dictionary.wallet.deposit)
              : (dictionary.wallet?.depositCancelled ?? dictionary.common.cancel)}
            <button
              type="button"
              style={{
                marginInlineStart: '12px',
                background: 'transparent',
                border: 'none',
                color: 'white',
                cursor: 'pointer',
                fontWeight: 'bold',
              }}
              onClick={() => setDepositMessage(null)}
              aria-label={dictionary.common.close ?? dictionary.common.cancel}
            >
              x
            </button>
          </div>
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
