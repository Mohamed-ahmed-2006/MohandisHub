'use client';

import type { ProviderAnalytics, Reservation, ServiceCategory } from '@mohandishub/shared';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';

import { BusinessJobsTab } from './business-jobs-tab';

import { analyticsApiClient } from '@/lib/analytics/client';
import { buildLocalePath } from '@/lib/i18n/path';
import type { Dictionary, Locale } from '@/lib/i18n/types';
import { reservationsApiClient } from '@/lib/reservations/client';


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
  const [orders, setOrders] = useState<Reservation[]>([]);
  const [ordersLoading, setOrdersLoading] = useState(false);
  const [analytics, setAnalytics] = useState<ProviderAnalytics | null>(null);
  const [analyticsLoading, setAnalyticsLoading] = useState(false);

  const loadOrders = useCallback(async () => {
    setOrdersLoading(true);
    try {
      const data = await reservationsApiClient.listMyReservations(accessToken, {
        role: 'provider',
        page: 1,
        limit: 50,
      });
      setOrders(data.items);
    } catch {
      setOrders([]);
    } finally {
      setOrdersLoading(false);
    }
  }, [accessToken]);

  const loadAnalytics = useCallback(async () => {
    setAnalyticsLoading(true);
    try {
      const data = await analyticsApiClient.getMyAnalytics(accessToken);
      setAnalytics(data);
    } catch {
      setAnalytics(null);
    } finally {
      setAnalyticsLoading(false);
    }
  }, [accessToken]);

  useEffect(() => {
    if (tab === 'orders') void loadOrders();
  }, [tab, loadOrders]);

  useEffect(() => {
    if (tab === 'analytics') void loadAnalytics();
  }, [tab, loadAnalytics]);

  const d = dictionary.appHome?.suggestions?.business ?? {};
  const nav = dictionary.nav ?? {};
  const common = dictionary.common ?? {};

  const isVerified = verificationStatus === 'verified';
  const navLabel = (key: string, fallback: string) =>
    (nav as Record<string, string>)[key] ?? fallback;

  const suggestions = dictionary.appHome?.suggestions?.business;
  const suggestTitle = suggestions?.title ?? 'Suggested actions for businesses';
  const suggestItems = (suggestions?.items ?? []) as string[];

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
          {ordersLoading ? (
            <p className="dashboard-empty">{common.loading ?? 'Loading...'}</p>
          ) : orders.length === 0 ? (
            <p className="dashboard-empty">
              {common.noOrders ?? 'No orders yet. Your reservations will appear here.'}
            </p>
          ) : (
            <ul className="dashboard-cards" style={{ listStyle: 'none', padding: 0, margin: 0 }}>
              {orders.map((r) => (
                <li key={r.id} className="dashboard-card" style={{ marginBottom: '0.75rem' }}>
                  <h4 className="dashboard-card-title">
                    {r.serviceTitle ?? (r.purpose === 'job_interview' ? 'Job Interview' : 'Reservation')}
                  </h4>
                  <p className="dashboard-card-meta">
                    {r.customerName ?? 'Customer'} · {r.status} ·{' '}
                    {new Date(r.createdAt).toLocaleDateString(undefined, {
                      month: 'short',
                      day: 'numeric',
                      year: 'numeric',
                    })}
                  </p>
                  <p className="dashboard-card-meta">
                    {r.expertPriceAmount?.toFixed(2)} {r.currency ?? 'EGP'}
                  </p>
                  <Link
                    href={buildLocalePath(locale, `/app/bookings?reservation=${r.id}`)}
                    className="dashboard-link-btn"
                  >
                    {common.viewDetails ?? 'View details'}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {tab === 'analytics' && (
        <div className="dashboard-empty-state">
          {analyticsLoading ? (
            <p className="dashboard-empty">{common.loading ?? 'Loading...'}</p>
          ) : analytics ? (
            <div className="dashboard-cards">
              <div className="dashboard-card">
                <h4 className="dashboard-card-title">
                  {common.totalEarnings ?? 'Total earnings'}
                </h4>
                <p className="dashboard-card-meta" style={{ fontSize: '1.25rem', fontWeight: 600 }}>
                  {analytics.totalEarnings.toFixed(2)} {analytics.currency}
                </p>
              </div>
              <div className="dashboard-card">
                <h4 className="dashboard-card-title">
                  {common.serviceViews ?? 'Service views'}
                </h4>
                <p className="dashboard-card-meta" style={{ fontSize: '1.25rem', fontWeight: 600 }}>
                  {analytics.totalServiceViews}
                </p>
              </div>
              <div className="dashboard-card">
                <h4 className="dashboard-card-title">
                  {common.ordersCount ?? 'Orders'}
                </h4>
                <p className="dashboard-card-meta" style={{ fontSize: '1.25rem', fontWeight: 600 }}>
                  {analytics.ordersCount}
                </p>
              </div>
              {analytics.topServices.length > 0 && (
                <div className="dashboard-card" style={{ gridColumn: '1 / -1' }}>
                  <h4 className="dashboard-card-title">
                    {common.topServices ?? 'Top services'}
                  </h4>
                  <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
                    {analytics.topServices.map((s) => (
                      <li
                        key={s.id}
                        className="dashboard-card-meta"
                        style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem' }}
                      >
                        <span>{s.title}</span>
                        <span>
                          {s.viewCount} views · {s.orderCount} orders
                          {s.avgRating != null ? ` · ${s.avgRating.toFixed(1)}★` : ''}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          ) : (
            <p className="dashboard-empty">{common.errorLoading ?? 'Failed to load analytics.'}</p>
          )}
        </div>
      )}

      {tab === 'jobs' && <BusinessJobsTab accessToken={accessToken} />}
    </section>
  );
};
