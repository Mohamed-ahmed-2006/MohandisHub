'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

import { AdminCategoriesTab } from './admin-categories-tab';
import { AdminDashboardTab } from './admin-dashboard-tab';
import { AdminPlansTab } from './admin-plans-tab';
import { AdminServicesTab } from './admin-services-tab';
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
  | 'verifications';

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
    if (authUser.role !== 'admin') {
      router.replace(buildLocalePath(locale, '/app'));
    }
  }, [isReady, isAuthenticated, authUser, authGuard.emailVerified, locale, router]);

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

  const tabs: { id: TabId; label: string }[] = [
    { id: 'dashboard', label: dictionary.admin.tabs.dashboard },
    { id: 'users', label: dictionary.admin.tabs.users },
    { id: 'plans', label: dictionary.admin.tabs.plans },
    { id: 'transactions', label: dictionary.admin.tabs.transactions },
    { id: 'services', label: dictionary.admin.tabs.services },
    { id: 'categories', label: dictionary.admin.tabs.categories },
    { id: 'verifications', label: dictionary.admin.tabs.verifications },
  ];

  return (
    <main className="admin-panel-main">
      <Container className="admin-panel-container">
        <div className="admin-panel-header">
          <h1 className="admin-panel-title">{dictionary.admin.title}</h1>
        </div>

        <div className="admin-panel-tabs">
          {tabs.map((tab) => (
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
          />
        )}
        {activeTab === 'plans' && (
          <AdminPlansTab dictionary={dictionary} accessToken={accessToken} />
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
            locale={locale}
            dictionary={dictionary}
            accessToken={accessToken}
          />
        )}
      </Container>
    </main>
  );
};
