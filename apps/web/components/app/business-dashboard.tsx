'use client';

import type { ProviderAnalytics, Reservation, Service, ServiceCategory } from '@mohandishub/shared';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';

import { BusinessJobsTab } from './business-jobs-tab';
import { BusinessTeamPanel } from './business-team-panel';

import { analyticsApiClient } from '@/lib/analytics/client';
import { buildLocalePath } from '@/lib/i18n/path';
import type { Dictionary, Locale } from '@/lib/i18n/types';
import { negotiationsApiClient } from '@/lib/negotiations/client';
import { reservationsApiClient } from '@/lib/reservations/client';
import { servicesApiClient } from '@/lib/services/client';

const getServiceStatusLabel = (status: string, sp: Record<string, string>): string => {
  const keyMap: Record<string, string> = {
    draft: 'statusDraft',
    pending_review: 'statusPending',
    active: 'statusActive',
    paused: 'statusPaused',
    rejected: 'statusRejected',
    archived: 'Archived',
  };
  const key = keyMap[status];
  return (key && sp[key]) ?? status;
};

type Props = {
  locale: Locale;
  dictionary: Dictionary;
  accessToken: string;
  categories: ServiceCategory[];
  verificationStatus?: string;
};

type BusinessTab = 'overview' | 'services' | 'orders' | 'analytics' | 'jobs' | 'team';

export const BusinessDashboard = ({
  locale,
  dictionary,
  accessToken,
  categories: _categories,
  verificationStatus = 'unverified',
}: Props) => {
  const [tab, setTab] = useState<BusinessTab>('overview');
  const [orders, setOrders] = useState<Reservation[]>([]);
  const [ordersLoading, setOrdersLoading] = useState(false);
  const [myServices, setMyServices] = useState<Service[]>([]);
  const [servicesLoading, setServicesLoading] = useState(false);
  const [analytics, setAnalytics] = useState<ProviderAnalytics | null>(null);
  const [analyticsLoading, setAnalyticsLoading] = useState(false);
  const [analyticsDays, setAnalyticsDays] = useState(30);
  const [overviewLoading, setOverviewLoading] = useState(false);
  const [overviewNegNeedAction, setOverviewNegNeedAction] = useState(0);
  const [overviewNegPending, setOverviewNegPending] = useState(0);
  const [overviewOrdersPreview, setOverviewOrdersPreview] = useState<Reservation[]>([]);

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
      const data = await analyticsApiClient.getMyAnalytics(accessToken, { days: analyticsDays });
      setAnalytics(data);
    } catch {
      setAnalytics(null);
    } finally {
      setAnalyticsLoading(false);
    }
  }, [accessToken, analyticsDays]);

  const loadMyServices = useCallback(async () => {
    setServicesLoading(true);
    try {
      const data = await servicesApiClient.listMyServices(accessToken, 1, 50);
      setMyServices(data.items);
    } catch {
      setMyServices([]);
    } finally {
      setServicesLoading(false);
    }
  }, [accessToken]);

  useEffect(() => {
    if (tab === 'orders') void loadOrders();
  }, [tab, loadOrders]);

  useEffect(() => {
    if (tab === 'services') void loadMyServices();
  }, [tab, loadMyServices]);

  useEffect(() => {
    if (tab === 'analytics') void loadAnalytics();
  }, [tab, loadAnalytics]);

  useEffect(() => {
    if (tab !== 'overview') return;
    let cancelled = false;
    void (async () => {
      setOverviewLoading(true);
      try {
        const [negRes, ordRes] = await Promise.all([
          negotiationsApiClient.list(accessToken, { role: 'provider', limit: 100 }),
          reservationsApiClient.listMyReservations(accessToken, {
            role: 'provider',
            page: 1,
            limit: 5,
          }),
        ]);
        if (cancelled) return;
        const pending = negRes.items.filter((n) => n.status === 'pending');
        const needAction = pending.filter((n) => n.latestOfferedBy === n.customerId).length;
        setOverviewNegNeedAction(needAction);
        setOverviewNegPending(pending.length);
        setOverviewOrdersPreview(ordRes.items);
      } catch {
        if (!cancelled) {
          setOverviewNegNeedAction(0);
          setOverviewNegPending(0);
          setOverviewOrdersPreview([]);
        }
      } finally {
        if (!cancelled) setOverviewLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [tab, accessToken]);

  const d = dictionary.appHome?.suggestions?.business ?? {};
  const needsDict = (dictionary.needs ?? {}) as Record<string, string>;
  const nav = dictionary.nav ?? {};
  const common = dictionary.common ?? {};

  const isVerified = verificationStatus === 'verified';
  const navLabel = (key: string, fallback: string) =>
    (nav as Record<string, string>)[key] ?? fallback;

  const suggestions = dictionary.appHome?.suggestions?.business;
  const suggestTitle = suggestions?.title ?? 'Suggested actions for businesses';
  const suggestItems = (suggestions?.items ?? []) as string[];
  const servicesPageDict =
    (dictionary as { servicesPage?: Record<string, string> }).servicesPage ?? {};
  const np = (dictionary as { negotiation?: Record<string, string> }).negotiation ?? {};
  const bo = (dictionary.appHome as { businessOverview?: Record<string, string> } | undefined)
    ?.businessOverview;

  return (
    <section className="dashboard-section">
      {suggestItems.length > 0 && (
        <div className="dashboard-suggestions">
          <h3
            className="dashboard-section-title"
            style={{ fontSize: '1rem', marginBottom: '0.5rem' }}
          >
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
          id="business-overview-tab"
          type="button"
          role="tab"
          aria-selected={tab === 'overview'}
          aria-controls="business-overview-panel"
          className={`dashboard-tab ${tab === 'overview' ? 'dashboard-tab--active' : ''}`}
          onClick={() => setTab('overview')}
        >
          {needsDict.customerNeedsOverview ?? 'Overview Customer Needs'}
        </button>
        <button
          id="business-services-tab"
          type="button"
          role="tab"
          aria-selected={tab === 'services'}
          aria-controls="business-services-panel"
          className={`dashboard-tab ${tab === 'services' ? 'dashboard-tab--active' : ''}`}
          onClick={() => setTab('services')}
        >
          {navLabel('myServices', 'My Services')}
        </button>
        <button
          id="business-orders-tab"
          type="button"
          role="tab"
          aria-selected={tab === 'orders'}
          aria-controls="business-orders-panel"
          className={`dashboard-tab ${tab === 'orders' ? 'dashboard-tab--active' : ''}`}
          onClick={() => setTab('orders')}
        >
          {navLabel('orders', 'Orders')}
        </button>
        <button
          id="business-analytics-tab"
          type="button"
          role="tab"
          aria-selected={tab === 'analytics'}
          aria-controls="business-analytics-panel"
          className={`dashboard-tab ${tab === 'analytics' ? 'dashboard-tab--active' : ''}`}
          onClick={() => setTab('analytics')}
        >
          {navLabel('analytics', 'Analytics')}
        </button>
        <button
          id="business-jobs-tab"
          type="button"
          role="tab"
          aria-selected={tab === 'jobs'}
          aria-controls="business-jobs-panel"
          className={`dashboard-tab ${tab === 'jobs' ? 'dashboard-tab--active' : ''}`}
          onClick={() => setTab('jobs')}
        >
          Jobs
        </button>
        <button
          id="business-team-tab"
          type="button"
          role="tab"
          aria-selected={tab === 'team'}
          aria-controls="business-team-panel"
          className={`dashboard-tab ${tab === 'team' ? 'dashboard-tab--active' : ''}`}
          onClick={() => setTab('team')}
        >
          Team
        </button>
      </div>

      {tab === 'overview' && (
        <div
          id="business-overview-panel"
          className="dashboard-empty-state"
          role="tabpanel"
          aria-labelledby="business-overview-tab"
        >
          {overviewLoading ? (
            <p className="dashboard-empty">{common.loading ?? 'Loading...'}</p>
          ) : (
            <ul
              className="dashboard-cards"
              style={{ listStyle: 'none', padding: 0, margin: '0 0 1rem' }}
            >
              <li className="dashboard-card" style={{ marginBottom: '0.75rem' }}>
                <h4 className="dashboard-card-title">
                  {bo?.negotiationsTitle ?? np.providerSectionTitle ?? 'Price negotiations'}
                </h4>
                <p className="dashboard-card-meta">
                  {overviewNegNeedAction > 0
                    ? (
                        bo?.negotiationsNeedAction ?? '{count} offer(s) need your response.'
                      ).replace('{count}', String(overviewNegNeedAction))
                    : overviewNegPending > 0
                      ? (bo?.negotiationsPending ?? '{count} open negotiation(s).').replace(
                          '{count}',
                          String(overviewNegPending),
                        )
                      : (bo?.negotiationsNone ?? np.noNegotiations ?? 'No negotiations yet.')}
                </p>
                <Link
                  href={buildLocalePath(locale, '/app/negotiations')}
                  className="dashboard-link-btn"
                >
                  {bo?.openNegotiationsInbox ?? np.openInbox ?? 'Open price negotiations'}
                </Link>
              </li>
              <li className="dashboard-card" style={{ marginBottom: '0.75rem' }}>
                <h4 className="dashboard-card-title">
                  {bo?.recentOrdersTitle ?? navLabel('orders', 'Orders')}
                </h4>
                {overviewOrdersPreview.length === 0 ? (
                  <p className="dashboard-empty" style={{ margin: 0 }}>
                    {common.noOrders ?? 'No orders yet.'}
                  </p>
                ) : (
                  <ul style={{ listStyle: 'none', padding: 0, margin: '0 0 0.5rem' }}>
                    {overviewOrdersPreview.slice(0, 3).map((r) => (
                      <li
                        key={r.id}
                        className="dashboard-card-meta"
                        style={{ marginBottom: '0.35rem' }}
                      >
                        {r.serviceTitle ?? 'Reservation'} · {r.status} ·{' '}
                        {new Date(r.createdAt).toLocaleDateString(undefined, {
                          month: 'short',
                          day: 'numeric',
                        })}
                      </li>
                    ))}
                  </ul>
                )}
                <Link
                  href={buildLocalePath(locale, '/app/bookings')}
                  className="dashboard-link-btn"
                >
                  {bo?.viewAllBookings ?? common.viewDetails ?? 'View bookings'}
                </Link>
              </li>
            </ul>
          )}
          <h4
            className="dashboard-section-title"
            style={{ fontSize: '1rem', marginBottom: '0.75rem', marginTop: '0.5rem' }}
          >
            {needsDict.customerNeedsOverview ?? 'Customer Needs Overview (My Bids)'}
          </h4>
          <p className="dashboard-empty">
            {needsDict.bidsOverviewFromSearchHint ??
              'Use Search -> Customer Need to view and manage your bid progress.'}
          </p>
        </div>
      )}

      {tab === 'services' && (
        <div
          id="business-services-panel"
          className="dashboard-empty-state"
          role="tabpanel"
          aria-labelledby="business-services-tab"
        >
          {servicesLoading ? (
            <p className="dashboard-empty">{common.loading ?? 'Loading...'}</p>
          ) : myServices.length === 0 ? (
            <>
              <p className="dashboard-empty">
                {common.addFirstService ?? 'Add your first service to start receiving orders.'}
              </p>
              <Link
                href={buildLocalePath(locale, '/app/services')}
                className="dashboard-primary-btn"
              >
                {d.ctaLabel ?? 'Manage Services'}
              </Link>
            </>
          ) : (
            <>
              <ul className="dashboard-cards" style={{ listStyle: 'none', padding: 0, margin: 0 }}>
                {myServices.map((s) => (
                  <li key={s.id} className="dashboard-card" style={{ marginBottom: '0.75rem' }}>
                    <h4 className="dashboard-card-title">{s.title}</h4>
                    <p className="dashboard-card-meta" style={{ marginBottom: '0.35rem' }}>
                      <span
                        className={`dashboard-badge dashboard-badge--${s.status.replace(/_/g, '-')}`}
                      >
                        {getServiceStatusLabel(s.status, servicesPageDict)}
                      </span>
                    </p>
                    {s.price != null && Number.isFinite(s.price) ? (
                      <p className="dashboard-card-meta">
                        {s.price.toFixed(2)} {s.currency}
                        {s.priceType === 'hourly'
                          ? ` · ${servicesPageDict.priceTypeHourly ?? '/hr'}`
                          : ''}
                      </p>
                    ) : null}
                    <Link
                      href={buildLocalePath(locale, '/app/services')}
                      className="dashboard-link-btn"
                    >
                      {d.ctaLabel ?? 'Manage Services'}
                    </Link>
                  </li>
                ))}
              </ul>
              <Link
                href={buildLocalePath(locale, '/app/services')}
                className="dashboard-primary-btn"
                style={{ marginTop: '1rem', display: 'inline-block' }}
              >
                {d.ctaLabel ?? 'Manage Services'}
              </Link>
            </>
          )}
        </div>
      )}

      {tab === 'orders' && (
        <div
          id="business-orders-panel"
          className="dashboard-empty-state"
          role="tabpanel"
          aria-labelledby="business-orders-tab"
        >
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
                    {r.serviceTitle ??
                      (r.purpose === 'job_interview' ? 'Job Interview' : 'Reservation')}
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
        <div
          id="business-analytics-panel"
          className="dashboard-empty-state"
          role="tabpanel"
          aria-labelledby="business-analytics-tab"
        >
          <div className="dashboard-actions-row" style={{ marginBottom: '1rem' }}>
            {[7, 30, 90, 365].map((days) => (
              <button
                key={days}
                type="button"
                className={`dashboard-secondary-btn ${analyticsDays === days ? 'dashboard-primary-btn' : ''}`}
                onClick={() => setAnalyticsDays(days)}
              >
                {days === 365 ? 'Year' : `${days} days`}
              </button>
            ))}
          </div>
          {analyticsLoading ? (
            <p className="dashboard-empty">{common.loading ?? 'Loading...'}</p>
          ) : analytics ? (
            <div className="dashboard-cards">
              <div className="dashboard-card">
                <h4 className="dashboard-card-title">{common.totalEarnings ?? 'Total earnings'}</h4>
                <p className="dashboard-card-meta" style={{ fontSize: '1.25rem', fontWeight: 600 }}>
                  {analytics.totalEarnings.toFixed(2)} {analytics.currency}
                </p>
              </div>
              <div className="dashboard-card">
                <h4 className="dashboard-card-title">{common.serviceViews ?? 'Service views'}</h4>
                <p className="dashboard-card-meta" style={{ fontSize: '1.25rem', fontWeight: 600 }}>
                  {analytics.totalServiceViews}
                </p>
              </div>
              <div className="dashboard-card">
                <h4 className="dashboard-card-title">{common.ordersCount ?? 'Orders'}</h4>
                <p className="dashboard-card-meta" style={{ fontSize: '1.25rem', fontWeight: 600 }}>
                  {analytics.ordersCount}
                </p>
              </div>
              <div className="dashboard-card">
                <h4 className="dashboard-card-title">Conversion</h4>
                <p className="dashboard-card-meta" style={{ fontSize: '1.25rem', fontWeight: 600 }}>
                  {analytics.conversion ? `${analytics.conversion.rate.toFixed(1)}%` : '0%'}
                </p>
                <p className="dashboard-card-meta">
                  {analytics.conversion?.orders ?? 0} orders / {analytics.conversion?.views ?? 0}{' '}
                  views
                </p>
              </div>
              {analytics.payoutForecast && (
                <div className="dashboard-card" style={{ gridColumn: '1 / -1' }}>
                  <h4 className="dashboard-card-title">Payout forecast</h4>
                  <p className="dashboard-card-meta">
                    Available: {analytics.payoutForecast.available.toFixed(2)}{' '}
                    {analytics.payoutForecast.currency} · Pending:{' '}
                    {analytics.payoutForecast.pending.toFixed(2)} · Held:{' '}
                    {analytics.payoutForecast.held.toFixed(2)}
                  </p>
                </div>
              )}
              {analytics.earningsTrend?.length ? (
                <div className="dashboard-card" style={{ gridColumn: '1 / -1' }}>
                  <h4 className="dashboard-card-title">Earnings trend</h4>
                  <div className="service-campaign-table-wrapper">
                    <table className="service-campaign-table">
                      <thead>
                        <tr>
                          <th>Date</th>
                          <th>Amount</th>
                          <th>Orders</th>
                        </tr>
                      </thead>
                      <tbody>
                        {analytics.earningsTrend.slice(-10).map((row) => {
                          const orders = analytics.orderTrend?.find(
                            (item) => item.date === row.date,
                          );
                          return (
                            <tr key={row.date}>
                              <td>{row.date}</td>
                              <td>
                                {row.amount.toFixed(2)} {analytics.currency}
                              </td>
                              <td>{orders?.count ?? 0}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              ) : null}
              {analytics.topServices.length > 0 && (
                <div className="dashboard-card" style={{ gridColumn: '1 / -1' }}>
                  <h4 className="dashboard-card-title">{common.topServices ?? 'Top services'}</h4>
                  <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
                    {analytics.topServices.map((s) => (
                      <li
                        key={s.id}
                        className="dashboard-card-meta"
                        style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          marginBottom: '0.5rem',
                        }}
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
              {analytics.servicePerformance?.length ? (
                <div className="dashboard-card" style={{ gridColumn: '1 / -1' }}>
                  <h4 className="dashboard-card-title">Service performance</h4>
                  <div className="service-campaign-table-wrapper">
                    <table className="service-campaign-table">
                      <thead>
                        <tr>
                          <th>Service</th>
                          <th>City</th>
                          <th>Completed</th>
                          <th>Cancelled</th>
                          <th>Disputes</th>
                        </tr>
                      </thead>
                      <tbody>
                        {analytics.servicePerformance.map((row) => (
                          <tr key={row.id}>
                            <td>{row.title}</td>
                            <td>{row.city ?? '-'}</td>
                            <td>{row.completionCount}</td>
                            <td>{row.cancellationCount}</td>
                            <td>{row.disputeCount}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              ) : null}
            </div>
          ) : (
            <p className="dashboard-empty">{common.errorLoading ?? 'Failed to load analytics.'}</p>
          )}
        </div>
      )}

      {tab === 'jobs' && (
        <div id="business-jobs-panel" role="tabpanel" aria-labelledby="business-jobs-tab">
          <BusinessJobsTab accessToken={accessToken} dictionary={dictionary} />
        </div>
      )}
      {tab === 'team' && (
        <div id="business-team-panel" role="tabpanel" aria-labelledby="business-team-tab">
          <BusinessTeamPanel dictionary={dictionary} accessToken={accessToken} />
        </div>
      )}
    </section>
  );
};
