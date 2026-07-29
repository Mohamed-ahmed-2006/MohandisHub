'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

import { AdminAdsTab } from './admin-ads-tab';
import { AdminCategoriesTab } from './admin-categories-tab';
import { AdminCommandPalette } from './admin-command-palette';
import { AdminCouponsTab } from './admin-coupons-tab';
import { AdminDashboardTab } from './admin-dashboard-tab';
import { AdminDisputesTab } from './admin-disputes-tab';
import { AdminMediaLibraryTab } from './admin-media-library-tab';
import { AdminMoneyAuditTab } from './admin-money-audit-tab';
import { AdminNotificationsTab } from './admin-notifications-tab';
import { AdminOperationsTab } from './admin-operations-tab';
import { AdminPlansTab } from './admin-plans-tab';
import { AdminRetentionTab } from './admin-retention-tab';
import { AdminReviewReportsTab } from './admin-review-reports-tab';
import { AdminServicesTab } from './admin-services-tab';
import { AdminSettingsTab } from './admin-settings-tab';
import { AdminSupportTab } from './admin-support-tab';
import { AdminTransactionsTab } from './admin-transactions-tab';
import { AdminUsersTab } from './admin-users-tab';
import { AdminVerificationsTab } from './admin-verifications-tab';
import { AdminWalletRailsTab } from './admin-wallet-rails-tab';

import { useAuth } from '@/components/auth/auth-provider';
import { Container } from '@/components/ui/container';
import { SkeletonCard } from '@/components/ui/skeleton';
import { buildLocalePath } from '@/lib/i18n/path';
import type { Dictionary, Locale } from '@/lib/i18n/types';

import './admin-panel.css';

type AdminPanelProps = {
  locale: Locale;
  dictionary: Dictionary;
};

type TabId =
  | 'dashboard'
  | 'users'
  | 'plans'
  | 'coupons'
  | 'transactions'
  | 'moneyAudit'
  | 'walletRails'
  | 'disputes'
  | 'services'
  | 'categories'
  | 'verifications'
  | 'reviewReports'
  | 'support'
  | 'notifications'
  | 'settings'
  | 'operations'
  | 'retention'
  | 'media'
  | 'ads';

const hasAdminPermission = (
  permissions: readonly string[] | undefined,
  permission: string,
): boolean => {
  const list = permissions ?? [];
  return list.includes('super_admin') || list.includes(permission);
};

export const AdminPanel = ({ locale, dictionary }: AdminPanelProps) => {
  const router = useRouter();
  const { authUser, accessToken, refreshSession, isAuthenticated, isReady, authGuard } = useAuth();
  const [activeTab, setActiveTab] = useState<TabId>('dashboard');
  const [cmdPaletteOpen, setCmdPaletteOpen] = useState(false);

  useEffect(() => {
    if (!isReady) return;
    if (!isAuthenticated || !authUser) {
      router.replace(`${buildLocalePath(locale, '/auth')}?mode=login`);
      return;
    }
    if (!authGuard.emailVerified) {
      router.replace(buildLocalePath(locale, '/verify-email'));
      return;
    }
    if (!authUser.isAdmin) {
      router.replace(buildLocalePath(locale, '/app'));
    }
  }, [isReady, isAuthenticated, authUser, authGuard.emailVerified, locale, router]);

  // Must be called unconditionally (Rules of Hooks) - before any early return
  const tabs: { id: TabId; label: string; permission?: string }[] = [
    { id: 'dashboard', label: dictionary.admin.tabs.dashboard },
    { id: 'users', label: dictionary.admin.tabs.users, permission: 'manage_users' },
    { id: 'plans', label: dictionary.admin.tabs.plans, permission: 'manage_plans' },
    { id: 'coupons', label: 'Coupons', permission: 'manage_plans' },
    {
      id: 'transactions',
      label: dictionary.admin.tabs.transactions,
      permission: 'manage_transactions',
    },
    {
      id: 'moneyAudit',
      label: dictionary.admin.tabs.moneyAudit ?? 'Money audit',
      permission: 'manage_transactions',
    },
    {
      id: 'walletRails',
      label: dictionary.admin.tabs.walletRails,
      permission: 'manage_transactions',
    },
    {
      id: 'disputes',
      label: dictionary.admin.tabs.disputes ?? 'Disputes',
      permission: 'manage_transactions',
    },
    { id: 'services', label: dictionary.admin.tabs.services, permission: 'manage_services' },
    { id: 'categories', label: dictionary.admin.tabs.categories, permission: 'manage_services' },
    {
      id: 'verifications',
      label: dictionary.admin.tabs.verifications,
      permission: 'manage_verifications',
    },
    {
      id: 'reviewReports',
      label: dictionary.admin.tabs.reviewReports || 'Review reports',
      permission: 'manage_verifications',
    },
    { id: 'support', label: dictionary.admin.tabs.support || 'Support', permission: 'manage_support' },
    {
      id: 'notifications',
      label: dictionary.admin.tabs.notifications || 'Notifications',
      permission: 'manage_notifications',
    },
    { id: 'ads', label: dictionary.admin.tabs.ads || 'Advertisements', permission: 'manage_ads' },
    { id: 'media', label: 'Media library', permission: 'manage_media' },
    { id: 'settings', label: dictionary.admin.tabs.settings || 'Settings', permission: 'manage_settings' },
    { id: 'operations', label: 'Operations', permission: 'super_admin' },
    {
      id: 'retention',
      label: dictionary.admin.tabs.retention || 'Retention',
      permission: 'manage_retention',
    },
  ];

  const filteredTabs = tabs.filter(
    (tab) => !tab.permission || hasAdminPermission(authUser?.adminPermissions, tab.permission),
  );

  useEffect(() => {
    if (!filteredTabs.some((t) => t.id === activeTab)) {
      setActiveTab('dashboard');
    }
  }, [activeTab, filteredTabs]);

  // Never render the admin surface for non-admins, unverified users, or while
  // auth state is settling. The redirect happens in the effect above; until it
  // completes we show only the skeleton so no admin UI ever paints.
  if (!isReady || !authUser || !accessToken || !authGuard.emailVerified || !authUser.isAdmin) {
    return (
      <main className="admin-panel-main">
        <Container className="admin-panel-container">
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            <SkeletonCard />
            <SkeletonCard />
            <SkeletonCard />
          </div>
        </Container>
      </main>
    );
  }

  return (
    <main className="admin-panel-main">
      <Container className="admin-panel-container">
        <div className="admin-panel-header">
          <div className="admin-panel-title-group">
            <h1 className="admin-panel-title">{dictionary.admin.title}</h1>
            <div className="admin-status-pill">
              <span className="admin-status-dot admin-status-dot--active" />
              <span>{locale === 'ar' ? 'نظام الإدارة نشط' : 'Engine active'}</span>
            </div>
          </div>

          <button
            type="button"
            className="admin-cmd-trigger-btn"
            onClick={() => setCmdPaletteOpen(true)}
          >
            <svg
              width="15"
              height="15"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
            <span>
              {locale === 'ar' ? 'بحث سريع وأوامر... (Ctrl + K)' : 'Search or command... (Ctrl + K)'}
            </span>
            <span className="admin-cmd-trigger-key">⌘K</span>
          </button>
        </div>

        <AdminCommandPalette
          isOpen={cmdPaletteOpen}
          onClose={() => setCmdPaletteOpen(false)}
          onSelectTab={(tabId) => setActiveTab(tabId)}
          tabs={filteredTabs}
          locale={locale}
        />

        <div className="admin-panel-tabs">
          {filteredTabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              className={`admin-panel-tab ${activeTab === tab.id ? 'admin-panel-tab--active' : ''}`}
              onClick={() => setActiveTab(tab.id)}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {activeTab === 'dashboard' && (
          <AdminDashboardTab
            dictionary={dictionary}
            accessToken={accessToken}
            refreshSession={refreshSession}
          />
        )}
        {activeTab === 'users' && (
          <AdminUsersTab
            dictionary={dictionary}
            accessToken={accessToken}
            refreshSession={refreshSession}
            adminPermissions={authUser.adminPermissions ?? []}
          />
        )}
        {activeTab === 'plans' && (
          <AdminPlansTab
            dictionary={dictionary}
            accessToken={accessToken}
            refreshSession={refreshSession}
          />
        )}
        {activeTab === 'coupons' && (
          <AdminCouponsTab
            dictionary={dictionary}
            accessToken={accessToken}
            refreshSession={refreshSession}
          />
        )}
        {activeTab === 'transactions' && (
          <AdminTransactionsTab dictionary={dictionary} accessToken={accessToken} />
        )}
        {activeTab === 'moneyAudit' && (
          <AdminMoneyAuditTab
            dictionary={dictionary}
            accessToken={accessToken}
            refreshSession={refreshSession}
          />
        )}
        {activeTab === 'walletRails' && (
          <AdminWalletRailsTab
            dictionary={dictionary}
            accessToken={accessToken}
            refreshSession={refreshSession}
          />
        )}
        {activeTab === 'disputes' && (
          <AdminDisputesTab
            dictionary={dictionary}
            accessToken={accessToken}
            refreshSession={refreshSession}
          />
        )}
        {activeTab === 'services' && (
          <AdminServicesTab dictionary={dictionary} accessToken={accessToken} />
        )}
        {activeTab === 'categories' && (
          <AdminCategoriesTab dictionary={dictionary} accessToken={accessToken} />
        )}
        {activeTab === 'verifications' && (
          <AdminVerificationsTab
            dictionary={dictionary}
            accessToken={accessToken}
            refreshSession={refreshSession}
          />
        )}
        {activeTab === 'reviewReports' && (
          <AdminReviewReportsTab dictionary={dictionary} accessToken={accessToken} />
        )}
        {activeTab === 'support' && (
          <AdminSupportTab
            dictionary={dictionary}
            accessToken={accessToken}
            refreshSession={refreshSession}
          />
        )}
        {activeTab === 'notifications' && (
          <AdminNotificationsTab
            dictionary={dictionary}
            accessToken={accessToken}
            refreshSession={refreshSession}
          />
        )}
        {activeTab === 'ads' && (
          <AdminAdsTab
            dictionary={dictionary}
            accessToken={accessToken}
            adminPermissions={authUser.adminPermissions ?? []}
          />
        )}
        {activeTab === 'settings' && (
          <AdminSettingsTab
            dictionary={dictionary}
            accessToken={accessToken}
            refreshSession={refreshSession}
          />
        )}
        {activeTab === 'operations' && (
          <AdminOperationsTab
            dictionary={dictionary}
            accessToken={accessToken}
            refreshSession={refreshSession}
          />
        )}
        {activeTab === 'media' && (
          <AdminMediaLibraryTab
            dictionary={dictionary}
            accessToken={accessToken}
            refreshSession={refreshSession}
          />
        )}
        {activeTab === 'retention' && (
          <AdminRetentionTab
            dictionary={dictionary}
            accessToken={accessToken}
            refreshSession={refreshSession}
          />
        )}
      </Container>
    </main>
  );
};
