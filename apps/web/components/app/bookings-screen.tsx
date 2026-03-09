'use client';

import type { Reservation } from '@mohandishub/shared';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';

import { useAuth } from '@/components/auth/auth-provider';
import { Container } from '@/components/ui/container';
import { buildLocalePath } from '@/lib/i18n/path';
import type { Dictionary, Locale } from '@/lib/i18n/types';
import { reservationsApiClient } from '@/lib/reservations/client';
import { OnlineCallModal } from './online-call-modal';

import '@/app/dashboard.css';

type Props = {
  locale: Locale;
  dictionary: Dictionary;
};

function formatDateTime(d: string): string {
  return new Date(d).toLocaleString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export const BookingsScreen = ({ locale, dictionary }: Props) => {
  const router = useRouter();
  const { authUser, accessToken, isAuthenticated, isReady, authGuard } = useAuth();
  const [reservations, setReservations] = useState<Reservation[]>([]);
  const [loading, setLoading] = useState(true);
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [callReservation, setCallReservation] = useState<Reservation | null>(null);

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
    setError(null);
    try {
      const res = await reservationsApiClient.listMyReservations(accessToken, {
        role,
        page: 1,
        limit: 50,
      });
      setReservations(res.items);
    } catch (e) {
      setReservations([]);
      setError(e instanceof Error ? e.message : 'Failed to load reservations');
    } finally {
      setLoading(false);
    }
  }, [accessToken, role]);

  useEffect(() => {
    void load();
  }, [load]);

  const decide = useCallback(
    async (id: string, decision: 'accept' | 'reject') => {
      if (!accessToken) return;
      setUpdatingId(id);
      setError(null);
      try {
        await reservationsApiClient.decideReservation(accessToken, id, {
          decision,
          ...(decision === 'reject' ? { rejectionReason: 'Rejected by provider' } : {}),
        });
        await load();
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Action failed');
      } finally {
        setUpdatingId(null);
      }
    },
    [accessToken, load],
  );

  const finish = useCallback(
    async (id: string, action: 'done' | 'report') => {
      if (!accessToken) return;
      setUpdatingId(id);
      setError(null);
      try {
        await reservationsApiClient.finishReservation(accessToken, id, {
          action,
          ...(action === 'report' ? { reportReason: 'Reported by customer' } : {}),
        });
        await load();
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Action failed');
      } finally {
        setUpdatingId(null);
      }
    },
    [accessToken, load],
  );

  const getCheckinCode = useCallback(
    async (id: string) => {
      if (!accessToken) return;
      setUpdatingId(id);
      try {
        const data = await reservationsApiClient.getOfflineCheckinCodes(accessToken, id);
        window.alert(`Your check-in code: ${data.myCode}`);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Could not load code');
      } finally {
        setUpdatingId(null);
      }
    },
    [accessToken],
  );

  const bp = dictionary.bookingsPage ?? {};
  const title = bp.title ?? 'My Reservations';
  const noBookings = bp.noBookings ?? 'No reservations yet.';

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
        {error && <p className="dashboard-error">{error}</p>}

        {loading ? (
          <p className="dashboard-loading">{dictionary.admin?.loading ?? 'Loading...'}</p>
        ) : reservations.length === 0 ? (
          <p className="dashboard-empty">{noBookings}</p>
        ) : (
          <ul className="calendar-booking-list">
            {reservations.map((r) => (
              <li key={r.id} className="calendar-booking-item">
                <div className="calendar-booking-info">
                  <span>{r.serviceTitle ?? 'Reservation'}</span>
                  {' - '}
                  <span>{r.mode === 'online' ? `Online (${r.onlineType ?? 'voice'})` : 'Offline'}</span>
                  {' - '}
                  <span>{formatDateTime(r.requestedStartAt)}</span>
                  <span className={`calendar-booking-status calendar-booking-status--${r.status}`}>
                    {r.status}
                  </span>
                  {r.rejectionReason && <p className="dashboard-card-meta">{r.rejectionReason}</p>}
                </div>

                <div className="calendar-booking-actions">
                  {role === 'provider' && r.status === 'pending' && (
                    <>
                      <button
                        type="button"
                        className="dashboard-btn dashboard-btn--small dashboard-btn--primary"
                        onClick={() => void decide(r.id, 'accept')}
                        disabled={updatingId === r.id}
                      >
                        Accept
                      </button>
                      <button
                        type="button"
                        className="dashboard-btn dashboard-btn--small dashboard-btn--danger"
                        onClick={() => void decide(r.id, 'reject')}
                        disabled={updatingId === r.id}
                      >
                        Reject
                      </button>
                    </>
                  )}

                  {role === 'customer' && r.status === 'waiting_customer_done' && (
                    <>
                      <button
                        type="button"
                        className="dashboard-btn dashboard-btn--small dashboard-btn--primary"
                        onClick={() => void finish(r.id, 'done')}
                        disabled={updatingId === r.id}
                      >
                        Done
                      </button>
                      <button
                        type="button"
                        className="dashboard-btn dashboard-btn--small dashboard-btn--danger"
                        onClick={() => void finish(r.id, 'report')}
                        disabled={updatingId === r.id}
                      >
                        Report
                      </button>
                    </>
                  )}

                  {r.mode === 'offline' && r.status === 'accepted' && (
                    <button
                      type="button"
                      className="dashboard-btn dashboard-btn--small dashboard-btn--secondary"
                      onClick={() => void getCheckinCode(r.id)}
                      disabled={updatingId === r.id}
                    >
                      My Check-in Code
                    </button>
                  )}

                  {r.mode === 'online' &&
                    (r.status === 'accepted' || r.status === 'in_session' || r.status === 'awaiting_start') && (
                      <button
                        type="button"
                        className="dashboard-btn dashboard-btn--small dashboard-btn--primary"
                        onClick={() => setCallReservation(r)}
                      >
                        Join Call
                      </button>
                    )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Container>

      <OnlineCallModal
        open={callReservation != null}
        reservation={callReservation}
        accessToken={accessToken ?? ''}
        onClose={() => setCallReservation(null)}
        onEnded={() => {
          void load();
        }}
      />
    </main>
  );
};
