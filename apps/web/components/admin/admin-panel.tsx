'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

import { AdminAdsTab } from './admin-ads-tab';
import { AdminCategoriesTab } from './admin-categories-tab';
import { AdminDashboardTab } from './admin-dashboard-tab';
import { AdminMediaLibraryTab } from './admin-media-library-tab';
import { AdminNotificationsTab } from './admin-notifications-tab';
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
  | 'transactions'
  | 'walletRails'
  | 'services'
  | 'categories'
  | 'verifications'
  | 'reviewReports'
  | 'support'
  | 'notifications'
  | 'settings'
  | 'retention'
  | 'media'
  | 'ads';

export const AdminPanel = ({ locale, dictionary }: AdminPanelProps) => {
  const router = useRouter();
  const { authUser, accessToken, refreshSession, isAuthenticated, isReady, authGuard } = useAuth();
  const [activeTab, setActiveTab] = useState<TabId>('dashboard');

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
    { id: 'transactions', label: dictionary.admin.tabs.transactions, permission: 'manage_transactions' },
    { id: 'walletRails', label: dictionary.admin.tabs.walletRails, permission: 'manage_transactions' },
    { id: 'services', label: dictionary.admin.tabs.services, permission: 'manage_services' },
    { id: 'categories', label: dictionary.admin.tabs.categories, permission: 'manage_services' },
    { id: 'verifications', label: dictionary.admin.tabs.verifications, permission: 'manage_verifications' },
    { id: 'reviewReports', label: dictionary.admin.tabs.reviewReports ?? '', permission: 'manage_verifications' },
    { id: 'support', label: dictionary.admin.tabs.support ?? '', permission: 'manage_support' },
    { id: 'notifications', label: dictionary.admin.tabs.notifications ?? '', permission: 'manage_notifications' },
    { id: 'ads', label: dictionary.admin.tabs.ads ?? 'Advertisements', permission: 'manage_ads' },
    { id: 'media', label: 'Media library', permission: 'manage_media' },
    { id: 'settings', label: dictionary.admin.tabs.settings, permission: 'manage_settings' },
    { id: 'retention', label: dictionary.admin.tabs.retention ?? 'Retention', permission: 'manage_retention' },
  ];

  const filteredTabs = tabs.filter(
    (tab) =>
      !tab.permission ||
      !authUser?.adminPermissions ||
      authUser.adminPermissions?.length === 0 ||
      authUser.adminPermissions?.includes(tab.permission),
  );

  useEffect(() => {
    if (!filteredTabs.some((t) => t.id === activeTab)) {
      setActiveTab('dashboard');
    }
  }, [activeTab, filteredTabs]);

  if (!isReady || !authUser || !accessToken) {
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
          <h1 className="admin-panel-title">{dictionary.admin.title}</h1>
        </div>

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
        {activeTab === 'transactions' && (
          <AdminTransactionsTab dictionary={dictionary} accessToken={accessToken} />
        )}
        {activeTab === 'walletRails' && (
          <AdminWalletRailsTab
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
