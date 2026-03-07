'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';

import { useAuth } from '@/components/auth/auth-provider';
import { Container } from '@/components/ui/container';
import type { ActivityItem } from '@/lib/activity/client';
import { getMyActivity } from '@/lib/activity/client';
import { buildLocalePath } from '@/lib/i18n/path';
import type { Dictionary, Locale } from '@/lib/i18n/types';

import './history-screen.css';

type Props = { locale: Locale; dictionary: Dictionary };

export const HistoryScreen = ({ locale, dictionary }: Props) => {
  const router = useRouter();
  const { authUser, accessToken, isAuthenticated, isReady, authGuard } = useAuth();

  const [items, setItems] = useState<ActivityItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);

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
        <Container>
          <p>{dictionary.appHome.loading}</p>
        </Container>
      </main>
    );
  }

  const typeLabel = (type: string) => {
    switch (type) {
      case 'credit':
        return 'Deposit';
      case 'debit':
        return 'Debit';
      default:
        return type;
    }
  };

  return (
    <main className="history-screen-main">
      <Container className="history-screen-container">
        <h1 className="history-screen-title">{dictionary.nav.history}</h1>

        {loading ? (
          <p>{dictionary.admin?.loading ?? 'Loading...'}</p>
        ) : items.length === 0 ? (
          <p className="history-screen-empty">No activity yet.</p>
        ) : (
          <>
            <div className="history-list">
              {items.map((item) => (
                <div key={item.id} className={`history-item history-item--${item.type}`}>
                  <div className="history-item-left">
                    <span className="history-item-type">{typeLabel(item.type)}</span>
                    {item.description && (
                      <span className="history-item-desc">{item.description}</span>
                    )}
                  </div>
                  <div className="history-item-right">
                    <span className={`history-item-amount history-item-amount--${item.type}`}>
                      {item.type === 'credit' ? '+' : '-'}
                      {parseFloat(item.amount).toFixed(2)}
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
              ))}
            </div>
            {totalPages > 1 && (
              <div className="history-pagination">
                <button
                  type="button"
                  disabled={page <= 1}
                  onClick={() => setPage((p) => p - 1)}
                  className="history-page-btn"
                >
                  ‹ Prev
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
                  Next ›
                </button>
              </div>
            )}
          </>
        )}
      </Container>
    </main>
  );
};
