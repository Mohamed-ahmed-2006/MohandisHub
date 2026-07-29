'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';

import { useAuth } from '@/components/auth/auth-provider';
import { Container } from '@/components/ui/container';
import type { ActivityItem } from '@/lib/activity/client';
import { getMyActivity } from '@/lib/activity/client';
import { useI18n } from '@/lib/i18n/context';
import { buildLocalePath } from '@/lib/i18n/path';

import './history-screen.css';

type Props = Record<string, never>;
type FilterType = 'all' | 'credit' | 'debit';

export const HistoryScreen = (_props: Props) => {
  const { locale, dictionary } = useI18n();
  const router = useRouter();
  const { authUser, accessToken, isAuthenticated, isReady, authGuard } = useAuth();

  const [items, setItems] = useState<ActivityItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [filter, setFilter] = useState<FilterType>('all');

  useEffect(() => {
    if (!isReady) return;
    if (!isAuthenticated || !authUser) {
      router.replace(`${buildLocalePath(locale, '/auth')}?mode=login`);
      return;
    }
    if (!authGuard.emailVerified) {
      router.replace(buildLocalePath(locale, '/verify-email'));
    }
  }, [isReady, isAuthenticated, authUser, authGuard.emailVerified, locale, router]);

  const load = useCallback(async () => {
    if (!accessToken) return;
    setLoading(true);
    try {
      const data = await getMyActivity(accessToken, page);
      setItems(data.items);
      setTotalPages(data.totalPages);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, [accessToken, page]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!isReady || !authUser) {
    return (
      <main className="history-screen-main">
        <Container className="history-screen-container">
          <p>{dictionary.appHome.loading}</p>
        </Container>
      </main>
    );
  }

  const isArabic = locale === 'ar';

  const typeLabel = (type: string) => {
    switch (type) {
      case 'credit':
        return isArabic ? 'إيداع / رصيد' : 'Deposit / Credit';
      case 'debit':
        return isArabic ? 'خصم / مدفوعات' : 'Debit / Payment';
      default:
        return type;
    }
  };

  const filteredItems = items.filter((item) => {
    if (filter === 'credit') return item.type === 'credit';
    if (filter === 'debit') return item.type === 'debit';
    return true;
  });

  const formatAmount = (amountStr: string) => {
    const val = Number.parseFloat(amountStr);
    return new Intl.NumberFormat(isArabic ? 'ar-EG' : 'en-US', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(Number.isFinite(val) ? val : 0);
  };

  return (
    <main className="history-screen-main">
      <Container className="history-screen-container">
        <div className="history-header">
          <h1 className="history-screen-title">{dictionary.nav.history}</h1>

          <div className="history-filters">
            <button
              type="button"
              className={`history-filter-btn ${filter === 'all' ? 'history-filter-btn--active' : ''}`}
              onClick={() => setFilter('all')}
            >
              {isArabic ? 'الكل' : 'All Activity'}
            </button>
            <button
              type="button"
              className={`history-filter-btn ${filter === 'credit' ? 'history-filter-btn--active' : ''}`}
              onClick={() => setFilter('credit')}
            >
              {isArabic ? 'الإيداعات (+)' : 'Deposits (+)'}
            </button>
            <button
              type="button"
              className={`history-filter-btn ${filter === 'debit' ? 'history-filter-btn--active' : ''}`}
              onClick={() => setFilter('debit')}
            >
              {isArabic ? 'المدفوعات (-)' : 'Payments (-)'}
            </button>
          </div>
        </div>

        {loading ? (
          <p className="admin-empty">{dictionary.admin?.loading ?? 'Loading history...'}</p>
        ) : filteredItems.length === 0 ? (
          <div className="history-empty-card">
            <div className="history-empty-icon">
              <svg
                width="28"
                height="28"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <circle cx="12" cy="12" r="10" />
                <polyline points="12 6 12 12 16 14" />
              </svg>
            </div>
            <h3 className="history-empty-title">
              {isArabic ? 'لا توجد سجلات نشاط' : 'No activity recorded yet'}
            </h3>
            <p className="history-empty-desc">
              {isArabic
                ? 'ستظهر جميع معاملتك المالية والإيداعات وسجلات الخدمات هنا تلقائياً.'
                : 'All your wallet deposits, service payments, and transaction records will appear here.'}
            </p>
          </div>
        ) : (
          <>
            <div className="history-list">
              {filteredItems.map((item) => {
                const isCredit = item.type === 'credit';
                return (
                  <div key={item.id} className={`history-item history-item--${item.type}`}>
                    <div className="history-item-left">
                      <div
                        className={`history-icon-badge ${
                          isCredit ? 'history-icon-badge--credit' : 'history-icon-badge--debit'
                        }`}
                      >
                        {isCredit ? (
                          <svg
                            width="20"
                            height="20"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2.5"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            aria-hidden="true"
                          >
                            <line x1="12" y1="19" x2="12" y2="5" />
                            <polyline points="5 12 12 5 19 12" />
                          </svg>
                        ) : (
                          <svg
                            width="20"
                            height="20"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2.5"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            aria-hidden="true"
                          >
                            <line x1="12" y1="5" x2="12" y2="19" />
                            <polyline points="19 12 12 19 5 12" />
                          </svg>
                        )}
                      </div>
                      <div className="history-item-details">
                        <span className="history-item-type">{typeLabel(item.type)}</span>
                        {item.description && (
                          <span className="history-item-desc">{item.description}</span>
                        )}
                      </div>
                    </div>
                    <div className="history-item-right">
                      <span className={`history-item-amount history-item-amount--${item.type}`}>
                        {isCredit ? '+' : '-'}
                        {formatAmount(item.amount)} EGP
                      </span>
                      <span className="history-item-date">
                        {new Date(item.created_at).toLocaleDateString(locale, {
                          day: 'numeric',
                          month: 'short',
                          year: 'numeric',
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>

            {totalPages > 1 && (
              <div className="history-pagination">
                <button
                  type="button"
                  disabled={page <= 1}
                  onClick={() => setPage((p) => p - 1)}
                  className="history-page-btn"
                >
                  ‹ {isArabic ? 'السابق' : 'Previous'}
                </button>
                <span className="history-page-info">
                  {page} / {totalPages}
                </span>
                <button
                  type="button"
                  disabled={page >= totalPages}
                  onClick={() => setPage((p) => p + 1)}
                  className="history-page-btn"
                >
                  {isArabic ? 'التالي' : 'Next'} ›
                </button>
              </div>
            )}
          </>
        )}
      </Container>
    </main>
  );
};
