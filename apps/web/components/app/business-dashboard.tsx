'use client';

import type { ServiceCategory } from '@mohandishub/shared';
import Link from 'next/link';
import { useState } from 'react';

import { BusinessJobsTab } from './business-jobs-tab';

import { buildLocalePath } from '@/lib/i18n/path';
import type { Dictionary, Locale } from '@/lib/i18n/types';


type Props = {
  locale: Locale;
  dictionary: Dictionary;
  accessToken: string;
  categories: ServiceCategory[];
  verificationStatus?: string;
};

type BusinessTab = 'services' | 'orders' | 'analytics' | 'jobs';

export const BusinessDashboard = ({
  locale,
  dictionary,
  accessToken,
  categories: _categories,
  verificationStatus = 'unverified',
}: Props) => {
  const [tab, setTab] = useState<BusinessTab>('services');
  const d = dictionary.appHome?.suggestions?.business ?? {};
  const nav = dictionary.nav ?? {};
  const common = dictionary.common ?? {};

  const isVerified = verificationStatus === 'verified';
  const navLabel = (key: string, fallback: string) =>
    (nav as Record<string, string>)[key] ?? fallback;

  const suggestions = dictionary.appHome?.suggestions?.business;
  const suggestTitle = suggestions?.title ?? 'Suggested actions for businesses';
  const suggestItems = suggestions?.items ?? [];

  return (
    <section className="dashboard-section">
      {suggestItems.length > 0 && (
        <div className="dashboard-suggestions">
          <h3 className="dashboard-section-title" style={{ fontSize: '1rem', marginBottom: '0.5rem' }}>
            {suggestTitle}
          </h3>
          <ul className="dashboard-suggestions-list">
            {suggestItems.map((item, i) => (
              <li key={i}>{item}</li>
            ))}
          </ul>
        </div>
      )}
      {!isVerified && (
        <div className="dashboard-banner dashboard-banner--warning" role="alert">
          <p>
            {common.completeVerification ??
              'Complete business verification to publish services and receive orders.'}
          </p>
          <Link
            href={buildLocalePath(locale, '/app/profile')}
            className="dashboard-primary-btn dashboard-primary-btn--small"
          >
            {navLabel('settings', 'Go to Profile')}
          </Link>
        </div>
      )}

      <div className="dashboard-tabs" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'services'}
          className={`dashboard-tab ${tab === 'services' ? 'dashboard-tab--active' : ''}`}
          onClick={() => setTab('services')}
        >
          {navLabel('myServices', 'My Services')}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'orders'}
          className={`dashboard-tab ${tab === 'orders' ? 'dashboard-tab--active' : ''}`}
          onClick={() => setTab('orders')}
        >
          {navLabel('orders', 'Orders')}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'analytics'}
          className={`dashboard-tab ${tab === 'analytics' ? 'dashboard-tab--active' : ''}`}
          onClick={() => setTab('analytics')}
        >
          {navLabel('analytics', 'Analytics')}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'jobs'}
          className={`dashboard-tab ${tab === 'jobs' ? 'dashboard-tab--active' : ''}`}
          onClick={() => setTab('jobs')}
        >
          Jobs
        </button>
      </div>

      {tab === 'services' && (
        <div className="dashboard-empty-state">
          <p className="dashboard-empty">
            {common.addFirstService ?? 'Add your first service to start receiving orders.'}
          </p>
          <Link
            href={buildLocalePath(locale, '/app/services')}
            className="dashboard-primary-btn"
          >
            {d.ctaLabel ?? 'Manage Services'}
          </Link>
        </div>
      )}

      {tab === 'orders' && (
        <div className="dashboard-empty-state">
          <p className="dashboard-empty">{common.comingSoon ?? 'Coming soon.'}</p>
        </div>
      )}

      {tab === 'analytics' && (
        <div className="dashboard-empty-state">
          <p className="dashboard-empty">{common.comingSoon ?? 'Coming soon.'}</p>
        </div>
      )}

      {tab === 'jobs' && <BusinessJobsTab accessToken={accessToken} />}
    </section>
  );
};
