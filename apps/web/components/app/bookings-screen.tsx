'use client';

import type { Booking } from '@mohandishub/shared';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';

import { useAuth } from '@/components/auth/auth-provider';
import { Container } from '@/components/ui/container';
import { bookingsApiClient } from '@/lib/bookings/client';
import { buildLocalePath } from '@/lib/i18n/path';
import type { Dictionary, Locale } from '@/lib/i18n/types';

import '@/app/dashboard.css';

type Props = {
  locale: Locale;
  dictionary: Dictionary;
};

function formatDate(d: string): string {
  return new Date(d).toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function formatTime(d: string): string {
  return new Date(d).toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
  });
}

export const BookingsScreen = ({ locale, dictionary }: Props) => {
  const router = useRouter();
  const { authUser, accessToken, isAuthenticated, isReady, authGuard } = useAuth();
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [loading, setLoading] = useState(true);
  const [updatingId, setUpdatingId] = useState<string | null>(null);

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

  const role: 'customer' | 'provider' =
    authUser?.role === 'expert' || authUser?.role === 'business' ? 'provider' : 'customer';

  const load = useCallback(async () => {
    if (!accessToken) return;
    setLoading(true);
    try {
      const res = await bookingsApiClient.listMy(accessToken, {
        role,
        page: 1,
        limit: 50,
      });
      setBookings(res.items);
    } catch {
      setBookings([]);
    } finally {
      setLoading(false);
    }
  }, [accessToken, role]);

  useEffect(() => {
    void load();
  }, [load]);

  const updateStatus = useCallback(
    async (id: string, status: string) => {
      if (!accessToken) return;
      setUpdatingId(id);
      try {
        await bookingsApiClient.update(accessToken, id, { status });
        void load();
      } catch {
        /* ignore */
      } finally {
        setUpdatingId(null);
      }
    },
    [accessToken, load],
  );

  const bp = dictionary.bookingsPage ?? {};
  const title = bp.title ?? 'My Bookings';
  const noBookings = bp.noBookings ?? 'No bookings yet.';
  const confirmComplete = bp.confirmComplete ?? 'Confirm completion';
  const start = bp.start ?? 'Start';
  const complete = bp.complete ?? 'Complete';

  if (!isReady || !authUser) {
    return (
      <main className="profile-screen-main">
        <Container>
          <p>{dictionary.appHome.loading}</p>
        </Container>
      </main>
    );
  }

  return (
    <main className="profile-screen-main">
      <Container className="profile-screen-container">
        <h1 className="dashboard-title">{title}</h1>

        {loading ? (
          <p className="dashboard-loading">{dictionary.admin?.loading ?? 'Loading...'}</p>
        ) : bookings.length === 0 ? (
          <p className="dashboard-empty">{noBookings}</p>
        ) : (
          <ul className="calendar-booking-list">
            {bookings.map((b) => (
              <li key={b.id} className="calendar-booking-item">
                <div className="calendar-booking-info">
                  <span>{b.serviceTitle ?? 'Booking'}</span>
                  {role === 'customer' && b.providerName && (
                    <>
                      {' — '}
                      <span>{b.providerName}</span>
                    </>
                  )}
                  {role === 'provider' && b.customerName && (
                    <>
                      {' — '}
                      <span>{b.customerName}</span>
                    </>
                  )}
                  {' — '}
                  {formatDate(b.slotStartAt ?? b.createdAt)}{' '}
                  {b.slotStartAt ? formatTime(b.slotStartAt) : ''}
                  <span
                    className={`calendar-booking-status calendar-booking-status--${b.status}`}
                  >
                    {b.status}
                  </span>
                </div>
                <div className="calendar-booking-actions">
                  {(b.status === 'paid' || b.status === 'scheduled') && role === 'provider' && (
                    <button
                      type="button"
                      className="dashboard-btn dashboard-btn--small dashboard-btn--primary"
                      onClick={() => void updateStatus(b.id, 'in_progress')}
                      disabled={updatingId === b.id}
                    >
                      {updatingId === b.id ? '...' : start}
                    </button>
                  )}
                  {b.status === 'in_progress' && (
                    <button
                      type="button"
                      className="dashboard-btn dashboard-btn--small dashboard-btn--primary"
                      onClick={() => void updateStatus(b.id, 'completed')}
                      disabled={updatingId === b.id}
                    >
                      {updatingId === b.id
                        ? '...'
                        : role === 'customer'
                          ? confirmComplete
                          : complete}
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Container>
    </main>
  );
};
