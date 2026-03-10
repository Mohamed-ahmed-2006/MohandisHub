'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

import { AdminCategoriesTab } from './admin-categories-tab';
import { AdminDashboardTab } from './admin-dashboard-tab';
import { AdminPlansTab } from './admin-plans-tab';
import { AdminServicesTab } from './admin-services-tab';
import { AdminSettingsTab } from './admin-settings-tab';
import { AdminTransactionsTab } from './admin-transactions-tab';
import { AdminUsersTab } from './admin-users-tab';
import { AdminVerificationsTab } from './admin-verifications-tab';

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
  | 'services'
  | 'categories'
  | 'verifications'
  | 'settings';

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
    { id: 'services', label: dictionary.admin.tabs.services, permission: 'manage_services' },
    { id: 'categories', label: dictionary.admin.tabs.categories, permission: 'manage_services' },
    { id: 'verifications', label: dictionary.admin.tabs.verifications, permission: 'manage_verifications' },
    { id: 'settings', label: dictionary.admin.tabs.settings, permission: 'manage_settings' },
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
        {activeTab === 'settings' && (
          <AdminSettingsTab
            dictionary={dictionary}
            accessToken={accessToken}
            refreshSession={refreshSession}
          />
        )}
      </Container>
    </main>
  );
};
