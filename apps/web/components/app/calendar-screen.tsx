'use client';

import type { Reservation, ReservationProfile, ReservationSlot } from '@mohandishub/shared';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { useAuth } from '@/components/auth/auth-provider';
import { Container } from '@/components/ui/container';
import { buildLocalePath } from '@/lib/i18n/path';
import type { Dictionary, Locale } from '@/lib/i18n/types';
import { reservationsApiClient } from '@/lib/reservations/client';

import '@/app/dashboard.css';

type Props = {
  locale: Locale;
  dictionary: Dictionary;
};

function formatDateLabel(date: Date): string {
  return date.toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function formatTimeLabel(date: Date): string {
  return date.toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
  });
}

const parseMoneyInput = (value: string): number => {
  const parsed = Number.parseFloat(value);
  if (!Number.isFinite(parsed) || parsed < 0) return 0;
  return Math.round(parsed * 100) / 100;
};

export const CalendarScreen = ({ locale, dictionary }: Props) => {
  const router = useRouter();
  const { authUser, accessToken, isAuthenticated, isReady, authGuard } = useAuth();

  const [slots, setSlots] = useState<ReservationSlot[]>([]);
  const [reservations, setReservations] = useState<Reservation[]>([]);
  const [profile, setProfile] = useState<ReservationProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [profileSaving, setProfileSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [profileError, setProfileError] = useState<string | null>(null);

  const [currentMonth, setCurrentMonth] = useState(() => {
    const d = new Date();
    d.setDate(1);
    d.setHours(0, 0, 0, 0);
    return d;
  });

  const [startAt, setStartAt] = useState('');
  const [endAt, setEndAt] = useState('');
  const [supportsOnline, setSupportsOnline] = useState(true);
  const [supportsOffline, setSupportsOffline] = useState(true);

  const [autoAccept, setAutoAccept] = useState(false);
  const [onlineVoicePrice, setOnlineVoicePrice] = useState('0');
  const [onlineVideoPrice, setOnlineVideoPrice] = useState('0');
  const [offlinePrice, setOfflinePrice] = useState('0');

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
    if (authUser.role !== 'expert' && authUser.role !== 'business') {
      router.replace(buildLocalePath(locale, '/app/bookings'));
    }
  }, [isReady, isAuthenticated, authUser, authGuard.emailVerified, locale, router]);

  const range = useMemo(() => {
    const from = new Date(currentMonth);
    const to = new Date(currentMonth);
    to.setMonth(to.getMonth() + 1);
    return { from, to };
  }, [currentMonth]);

  const load = useCallback(async () => {
    if (!accessToken) return;
    setLoading(true);
    setError(null);
    setProfileError(null);
    try {
      const [slotsRes, reservationsRes, profileRes] = await Promise.all([
        reservationsApiClient.listSlots(accessToken, {
          from: range.from.toISOString(),
          to: range.to.toISOString(),
          availableOnly: false,
        }),
        reservationsApiClient.listMyReservations(accessToken, {
          role: 'provider',
          page: 1,
          limit: 100,
        }),
        reservationsApiClient.getMyProfile(accessToken),
      ]);
      setSlots(slotsRes.items);
      setReservations(reservationsRes.items);
      setProfile(profileRes);
      setAutoAccept(profileRes.autoAccept);
      setOnlineVoicePrice(profileRes.onlineVoicePrice.toString());
      setOnlineVideoPrice(profileRes.onlineVideoPrice.toString());
      setOfflinePrice(profileRes.offlinePrice.toString());
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Failed to load calendar data';
      setError(message);
      setProfileError(message);
      setSlots([]);
      setReservations([]);
      setProfile(null);
    } finally {
      setLoading(false);
    }
  }, [accessToken, range.from, range.to]);

  useEffect(() => {
    void load();
  }, [load]);

  const saveProfile = useCallback(async () => {
    if (!accessToken) return;
    setProfileSaving(true);
    setProfileError(null);
    try {
      const updated = await reservationsApiClient.updateMyProfile(accessToken, {
        autoAccept,
        onlineVoicePrice: parseMoneyInput(onlineVoicePrice),
        onlineVideoPrice: parseMoneyInput(onlineVideoPrice),
        offlinePrice: parseMoneyInput(offlinePrice),
      });
      setProfile(updated);
      setAutoAccept(updated.autoAccept);
      setOnlineVoicePrice(updated.onlineVoicePrice.toString());
      setOnlineVideoPrice(updated.onlineVideoPrice.toString());
      setOfflinePrice(updated.offlinePrice.toString());
    } catch (e) {
      setProfileError(e instanceof Error ? e.message : 'Could not update reservation settings');
    } finally {
      setProfileSaving(false);
    }
  }, [accessToken, autoAccept, offlinePrice, onlineVideoPrice, onlineVoicePrice]);

  const createSlot = useCallback(
    async (event: React.FormEvent) => {
      event.preventDefault();
      if (!accessToken || !startAt || !endAt) return;
      setSaving(true);
      setError(null);
      try {
        await reservationsApiClient.createSlot(accessToken, {
          startAt: new Date(startAt).toISOString(),
          endAt: new Date(endAt).toISOString(),
          supportsOnline,
          supportsOffline,
        });
        setStartAt('');
        setEndAt('');
        await load();
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Could not create slot');
      } finally {
        setSaving(false);
      }
    },
    [accessToken, endAt, load, startAt, supportsOffline, supportsOnline],
  );

  const updateSlotStatus = useCallback(
    async (slotId: string, status: 'available' | 'blocked') => {
      if (!accessToken) return;
      try {
        await reservationsApiClient.updateSlot(accessToken, slotId, { status });
        await load();
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Could not update slot');
      }
    },
    [accessToken, load],
  );

  const removeSlot = useCallback(
    async (slotId: string) => {
      if (!accessToken) return;
      try {
        await reservationsApiClient.deleteSlot(accessToken, slotId);
        await load();
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Could not remove slot');
      }
    },
    [accessToken, load],
  );

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
        <h1 className="dashboard-title">{dictionary.calendarPage?.title ?? 'Reservation Calendar'}</h1>
        {error && <p className="dashboard-error">{error}</p>}

        <div className="calendar-toolbar motion-reveal">
          <button
            type="button"
            className="dashboard-btn dashboard-btn--secondary"
            onClick={() =>
              setCurrentMonth((prev) => {
                const next = new Date(prev);
                next.setMonth(next.getMonth() - 1);
                return next;
              })
            }
          >
            Prev Month
          </button>
          <span className="calendar-week-label">
            {currentMonth.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}
          </span>
          <button
            type="button"
            className="dashboard-btn dashboard-btn--secondary"
            onClick={() =>
              setCurrentMonth((prev) => {
                const next = new Date(prev);
                next.setMonth(next.getMonth() + 1);
                return next;
              })
            }
          >
            Next Month
          </button>
        </div>

        <section className="dashboard-card" style={{ marginBottom: '1rem' }}>
          <h2 className="dashboard-section-title" style={{ fontSize: '1rem' }}>
            Reservation Settings
          </h2>
          <p className="dashboard-card-meta" style={{ marginBottom: '0.75rem' }}>
            Set fixed reservation prices and auto-accept behavior for your incoming reservation requests.
          </p>
          {profileError && <p className="dashboard-error">{profileError}</p>}
          <div className="reservation-settings-grid">
            <label className="dashboard-card-meta">
              <input
                type="checkbox"
                checked={autoAccept}
                onChange={(e) => setAutoAccept(e.target.checked)}
              />
              {' '}Auto-accept requests when slot is still free
            </label>
            <label className="dashboard-card-meta">
              Voice session fixed price (EGP)
              <input
                type="number"
                min={0}
                step={0.01}
                className="dashboard-input"
                value={onlineVoicePrice}
                onChange={(e) => setOnlineVoicePrice(e.target.value)}
              />
            </label>
            <label className="dashboard-card-meta">
              Video session fixed price (EGP)
              <input
                type="number"
                min={0}
                step={0.01}
                className="dashboard-input"
                value={onlineVideoPrice}
                onChange={(e) => setOnlineVideoPrice(e.target.value)}
              />
            </label>
            <label className="dashboard-card-meta">
              Offline session fixed price (EGP)
              <input
                type="number"
                min={0}
                step={0.01}
                className="dashboard-input"
                value={offlinePrice}
                onChange={(e) => setOfflinePrice(e.target.value)}
              />
            </label>
          </div>
          <div className="dashboard-card-actions">
            <button
              type="button"
              className="dashboard-btn dashboard-btn--primary"
              onClick={() => void saveProfile()}
              disabled={profileSaving || loading || profile == null}
            >
              {profileSaving ? 'Saving...' : 'Save Reservation Settings'}
            </button>
          </div>
        </section>

        <section className="dashboard-card" style={{ marginBottom: '1rem' }}>
          <h2 className="dashboard-section-title" style={{ fontSize: '1rem' }}>
            Add Slot
          </h2>
          <form onSubmit={(e) => void createSlot(e)} className="dashboard-form">
            <input
              type="datetime-local"
              value={startAt}
              onChange={(e) => setStartAt(e.target.value)}
              className="dashboard-input"
              required
            />
            <input
              type="datetime-local"
              value={endAt}
              onChange={(e) => setEndAt(e.target.value)}
              className="dashboard-input"
              required
            />
            <label className="dashboard-card-meta">
              <input
                type="checkbox"
                checked={supportsOnline}
                onChange={(e) => setSupportsOnline(e.target.checked)}
              />
              {' '}Online
            </label>
            <label className="dashboard-card-meta">
              <input
                type="checkbox"
                checked={supportsOffline}
                onChange={(e) => setSupportsOffline(e.target.checked)}
              />
              {' '}Offline
            </label>
            <button type="submit" className="dashboard-primary-btn" disabled={saving}>
              {saving ? '...' : dictionary.calendarPage?.addSlot ?? 'Add Slot'}
            </button>
          </form>
        </section>

        {loading ? (
          <p className="dashboard-loading">{dictionary.admin?.loading ?? 'Loading...'}</p>
        ) : (
          <>
            <section style={{ marginBottom: '1rem' }}>
              <h2 className="dashboard-section-title" style={{ fontSize: '1rem' }}>
                Slots
              </h2>
              {slots.length === 0 ? (
                <p className="dashboard-empty">{dictionary.calendarPage?.noSlots ?? 'No slots in this month.'}</p>
              ) : (
                <ul className="calendar-slot-list">
                  {slots.map((slot) => {
                    const start = new Date(slot.startAt);
                    const end = new Date(slot.endAt);
                    return (
                      <li key={slot.id} className={`calendar-slot-item calendar-slot-item--${slot.status}`}>
                        <div className="calendar-slot-info">
                          <span className="calendar-slot-time">
                            {formatDateLabel(start)} {formatTimeLabel(start)} - {formatTimeLabel(end)}
                          </span>
                          <span className="calendar-slot-status">
                            {slot.status} | {slot.supportsOnline ? 'Online' : ''}{slot.supportsOnline && slot.supportsOffline ? ' + ' : ''}{slot.supportsOffline ? 'Offline' : ''}
                          </span>
                        </div>
                        <div className="calendar-slot-actions">
                          {slot.status === 'available' && (
                            <button
                              type="button"
                              className="dashboard-btn dashboard-btn--small"
                              onClick={() => void updateSlotStatus(slot.id, 'blocked')}
                            >
                              Block
                            </button>
                          )}
                          {slot.status === 'blocked' && (
                            <button
                              type="button"
                              className="dashboard-btn dashboard-btn--small"
                              onClick={() => void updateSlotStatus(slot.id, 'available')}
                            >
                              Unblock
                            </button>
                          )}
                          {(slot.status === 'available' || slot.status === 'blocked') && (
                            <button
                              type="button"
                              className="dashboard-btn dashboard-btn--small dashboard-btn--danger"
                              onClick={() => void removeSlot(slot.id)}
                            >
                              Remove
                            </button>
                          )}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>

            <section>
              <h2 className="dashboard-section-title" style={{ fontSize: '1rem' }}>
                Reservations
              </h2>
              {reservations.length === 0 ? (
                <p className="dashboard-empty">No reservations in this period.</p>
              ) : (
                <ul className="calendar-booking-list">
                  {reservations.map((r) => (
                    <li key={r.id} className="calendar-booking-item">
                      <div className="calendar-booking-info">
                        <span>{r.serviceTitle ?? 'Reservation'}</span>
                        {' - '}
                        <span>{r.mode === 'online' ? `Online (${r.onlineType ?? 'voice'})` : 'Offline'}</span>
                        {' - '}
                        <span>{formatDateLabel(new Date(r.requestedStartAt))}</span>
                        <span className={`calendar-booking-status calendar-booking-status--${r.status}`}>
                          {r.status}
                        </span>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </>
        )}
      </Container>
    </main>
  );
};
