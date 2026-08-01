'use client';

import type { ProviderAnalytics } from '@mohandishub/shared';
import { isProviderRole } from '@mohandishub/shared';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';

import { useAuth } from '@/components/auth/auth-provider';
import { Container } from '@/components/ui/container';
import { analyticsApiClient } from '@/lib/analytics/client';
import { useI18n } from '@/lib/i18n/context';
import { buildLocalePath } from '@/lib/i18n/path';

// NOTE: Client-side route guards present UX redirection; the backend API endpoints
// (e.g. GET /api/analytics/me) remain the primary, authoritative security boundary.

export const ProviderAnalyticsScreen = () => {
  const { locale, dictionary } = useI18n();
  const { authUser, accessToken, isReady, isAuthenticated } = useAuth();
  const [analyticsDays, setAnalyticsDays] = useState(30);
  const [analytics, setAnalytics] = useState<ProviderAnalytics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const isProvider = authUser?.role ? isProviderRole(authUser.role) : false;
  const common = dictionary.common ?? {};
  const isAr = locale === 'ar';

  const loadAnalytics = useCallback(async () => {
    if (!accessToken || !isProvider) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const data = await analyticsApiClient.getMyAnalytics(accessToken, { days: analyticsDays });
      setAnalytics(data);
    } catch {
      setError(isAr ? 'فشل تحميل البيانات التحليلية.' : 'Failed to load analytics data.');
      setAnalytics(null);
    } finally {
      setLoading(false);
    }
  }, [accessToken, isProvider, analyticsDays, isAr]);

  useEffect(() => {
    void loadAnalytics();
  }, [loadAnalytics]);

  if (isReady && (!isAuthenticated || !isProvider)) {
    return (
      <Container>
        <div style={{ padding: '2rem 0', textAlign: 'center' }}>
          <p>
            {isAr
              ? 'هذه الصفحة مخصصة لمزودي الخدمات فقط.'
              : 'Analytics is available for providers only.'}
          </p>
          <Link
            href={buildLocalePath(locale, '/app')}
            style={{ color: '#0f766e', fontWeight: 600 }}
          >
            {common.backToHome ?? 'Back to home'}
          </Link>
        </div>
      </Container>
    );
  }

  return (
    <Container>
      <div style={{ padding: '1.5rem 0', display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h1 style={{ fontSize: '1.5rem', fontWeight: 700, margin: 0 }}>
            {dictionary.nav?.analytics ?? (isAr ? 'التحليلات' : 'Analytics')}
          </h1>
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            {[7, 30, 90, 365].map((days) => (
              <button
                key={days}
                type="button"
                className={`dashboard-secondary-btn ${analyticsDays === days ? 'dashboard-primary-btn' : ''}`}
                onClick={() => setAnalyticsDays(days)}
                style={{
                  padding: '0.4rem 0.8rem',
                  borderRadius: '6px',
                  border: '1px solid #d1d5db',
                  background: analyticsDays === days ? '#0f766e' : '#fff',
                  color: analyticsDays === days ? '#fff' : '#374151',
                  cursor: 'pointer',
                  fontSize: '0.875rem',
                }}
              >
                {days === 365 ? (isAr ? 'سنة' : 'Year') : isAr ? `${days} يوم` : `${days} days`}
              </button>
            ))}
          </div>
        </div>

        {loading ? (
          <p>{common.loading ?? 'Loading...'}</p>
        ) : error ? (
          <p style={{ color: '#dc2626' }}>{error}</p>
        ) : analytics ? (
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
              gap: '1rem',
            }}
          >
            <div
              style={{
                background: '#f9fafb',
                border: '1px solid #e5e7eb',
                borderRadius: '8px',
                padding: '1.25rem',
              }}
            >
              <h4 style={{ margin: 0, fontSize: '0.875rem', color: '#6b7280' }}>
                {common.totalEarnings ?? 'Total earnings'}
              </h4>
              <p
                style={{
                  margin: '0.5rem 0 0',
                  fontSize: '1.5rem',
                  fontWeight: 700,
                  color: '#111827',
                }}
              >
                {analytics.totalEarnings.toFixed(2)} {analytics.currency}
              </p>
            </div>
            <div
              style={{
                background: '#f9fafb',
                border: '1px solid #e5e7eb',
                borderRadius: '8px',
                padding: '1.25rem',
              }}
            >
              <h4 style={{ margin: 0, fontSize: '0.875rem', color: '#6b7280' }}>
                {common.serviceViews ?? 'Service views'}
              </h4>
              <p
                style={{
                  margin: '0.5rem 0 0',
                  fontSize: '1.5rem',
                  fontWeight: 700,
                  color: '#111827',
                }}
              >
                {analytics.totalServiceViews}
              </p>
            </div>
            <div
              style={{
                background: '#f9fafb',
                border: '1px solid #e5e7eb',
                borderRadius: '8px',
                padding: '1.25rem',
              }}
            >
              <h4 style={{ margin: 0, fontSize: '0.875rem', color: '#6b7280' }}>
                {common.ordersCount ?? 'Orders'}
              </h4>
              <p
                style={{
                  margin: '0.5rem 0 0',
                  fontSize: '1.5rem',
                  fontWeight: 700,
                  color: '#111827',
                }}
              >
                {analytics.ordersCount}
              </p>
            </div>
            <div
              style={{
                background: '#f9fafb',
                border: '1px solid #e5e7eb',
                borderRadius: '8px',
                padding: '1.25rem',
              }}
            >
              <h4 style={{ margin: 0, fontSize: '0.875rem', color: '#6b7280' }}>
                {isAr ? 'معدل التحويل' : 'Conversion'}
              </h4>
              <p
                style={{
                  margin: '0.5rem 0 0',
                  fontSize: '1.5rem',
                  fontWeight: 700,
                  color: '#111827',
                }}
              >
                {analytics.conversion ? `${analytics.conversion.rate.toFixed(1)}%` : '0%'}
              </p>
              <p style={{ margin: '0.25rem 0 0', fontSize: '0.75rem', color: '#9ca3af' }}>
                {analytics.conversion?.orders ?? 0} {isAr ? 'طلبات' : 'orders'} /{' '}
                {analytics.conversion?.views ?? 0} {isAr ? 'مشاهدات' : 'views'}
              </p>
            </div>

            {analytics.topServices?.length > 0 && (
              <div
                style={{
                  gridColumn: '1 / -1',
                  background: '#fff',
                  border: '1px solid #e5e7eb',
                  borderRadius: '8px',
                  padding: '1.25rem',
                }}
              >
                <h3 style={{ margin: '0 0 1rem', fontSize: '1rem', fontWeight: 600 }}>
                  {common.topServices ?? (isAr ? 'الأعلى أداءً' : 'Top services')}
                </h3>
                <ul
                  style={{
                    listStyle: 'none',
                    margin: 0,
                    padding: 0,
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '0.75rem',
                  }}
                >
                  {analytics.topServices.map((svc) => (
                    <li
                      key={svc.id}
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        borderBottom: '1px solid #f3f4f6',
                        paddingBottom: '0.5rem',
                      }}
                    >
                      <span style={{ fontWeight: 500 }}>{svc.title}</span>
                      <span style={{ fontSize: '0.875rem', color: '#6b7280' }}>
                        {svc.viewCount} {isAr ? 'مشاهدة' : 'views'} · {svc.orderCount}{' '}
                        {isAr ? 'طلب' : 'orders'}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        ) : null}
      </div>
    </Container>
  );
};
