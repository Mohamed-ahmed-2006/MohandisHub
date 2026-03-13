'use client';

import type { Reservation, ReservationProfile, ReservationSlot } from '@mohandishub/shared';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';

import {
  buildMonthMatrix,
  chooseInitialSelectedDay,
  groupReservationsByDate,
  groupSlotsByDate,
  isDateInMonth,
  isDateKeyInMonth,
  parseDateKey,
} from './calendar-utils';

import { useAuth } from '@/components/auth/auth-provider';
import { Container } from '@/components/ui/container';
import { useI18n } from '@/lib/i18n/context';
import { buildLocalePath } from '@/lib/i18n/path';
import { reservationsApiClient } from '@/lib/reservations/client';

import '@/app/dashboard.css';

type Props = Record<string, never>;

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

const withDayKeyAndTime = (value: string, dayKey: string, fallbackTime: string): string => {
  const timePart = value.includes('T') ? value.slice(value.indexOf('T') + 1, value.indexOf('T') + 6) : '';
  return `${dayKey}T${timePart || fallbackTime}`;
};

export const CalendarScreen = (_props: Props) => {
  const { locale, dictionary } = useI18n();
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
  const [selectedDayKey, setSelectedDayKey] = useState<string | null>(null);

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
        setStartAt((prev) => {
          const dayKey = prev.split('T')[0];
          return dayKey ? `${dayKey}T09:00` : '';
        });
        setEndAt((prev) => {
          const dayKey = prev.split('T')[0];
          return dayKey ? `${dayKey}T10:00` : '';
        });
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

  const monthReservations = useMemo(
    () =>
      reservations.filter((reservation) =>
        isDateInMonth(new Date(reservation.requestedStartAt), currentMonth),
      ),
    [reservations, currentMonth],
  );

  const slotsByDay = useMemo(() => groupSlotsByDate(slots), [slots]);
  const reservationsByDay = useMemo(
    () => groupReservationsByDate(monthReservations),
    [monthReservations],
  );
  const monthMatrix = useMemo(() => buildMonthMatrix(currentMonth), [currentMonth]);

  useEffect(() => {
    setSelectedDayKey((prev) => {
      if (prev && isDateKeyInMonth(prev, currentMonth)) return prev;
      return chooseInitialSelectedDay({
        monthStart: currentMonth,
        slotBuckets: slotsByDay,
        reservationBuckets: reservationsByDay,
      });
    });
  }, [currentMonth, reservationsByDay, slotsByDay]);

  useEffect(() => {
    if (!selectedDayKey) return;
    setStartAt((prev) => withDayKeyAndTime(prev, selectedDayKey, '09:00'));
    setEndAt((prev) => withDayKeyAndTime(prev, selectedDayKey, '10:00'));
  }, [selectedDayKey]);

  const selectedDaySlots = selectedDayKey ? (slotsByDay[selectedDayKey] ?? []) : [];
  const selectedDayReservations = selectedDayKey ? (reservationsByDay[selectedDayKey] ?? []) : [];
  const selectedDayDate = selectedDayKey ? parseDateKey(selectedDayKey) : currentMonth;
  const weekdayHeaders = useMemo(() => {
    const baseSunday = new Date(2026, 0, 4);
    return Array.from({ length: 7 }, (_, index) => {
      const d = new Date(baseSunday);
      d.setDate(baseSunday.getDate() + index);
      return d.toLocaleDateString(locale, { weekday: 'short' });
    });
  }, [locale]);

  const cp = dictionary.calendarPage ?? {};
  const title = cp.title ?? 'Calendar';
  const prevMonth = cp.prevMonth ?? 'Prev Month';
  const nextMonth = cp.nextMonth ?? 'Next Month';
  const settingsTitle = cp.reservationSettingsTitle ?? 'Reservation Settings';
  const settingsDescription =
    cp.reservationSettingsDescription ??
    'Set fixed reservation prices and auto-accept behavior for incoming requests.';
  const saveSettings = cp.saveReservationSettings ?? 'Save Reservation Settings';
  const addSlotTitle = cp.addSlotTitle ?? 'Add Slot';
  const addSlotForDay = cp.addSlotForDay ?? 'Selected day';
  const dayDetailsTitle = cp.dayDetailsTitle ?? 'Day Details';
  const selectedDayLabel = cp.selectedDay ?? 'Selected day';
  const slotsTitle = cp.slotsTitle ?? 'Slots';
  const reservationsTitle = cp.reservationsTitle ?? 'Reservations';
  const noItemsForDay = cp.noItemsForDay ?? 'No slots or reservations on this day.';
  const noSlotsForDay = cp.noSlotsForDay ?? 'No slots on this day.';
  const noReservationsForDay = cp.noReservationsForDay ?? 'No reservations on this day.';
  const onlineText = cp.online ?? 'Online';
  const offlineText = cp.offline ?? 'Offline';

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
        <div className="app-page-header">
          <h1 className="app-page-title">{title}</h1>
        </div>
        {error && <p className="dashboard-error">{error}</p>}

        <div className="calendar-shell">
          <section className="calendar-main">
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
                {prevMonth}
              </button>
              <span className="calendar-week-label">
                {currentMonth.toLocaleDateString(locale, { month: 'long', year: 'numeric' })}
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
                {nextMonth}
              </button>
            </div>

            <section className="calendar-month-grid" aria-label={title}>
              {weekdayHeaders.map((label) => (
                <div key={label} className="calendar-day-header">
                  {label}
                </div>
              ))}
              {monthMatrix.flatMap((week, weekIndex) =>
                week.map((cell, dayIndex) => {
                  if (!cell.dateKey || !cell.dayOfMonth) {
                    return (
                      <div
                        key={`empty-${weekIndex}-${dayIndex}`}
                        className="calendar-day calendar-day--empty"
                        aria-hidden="true"
                      />
                    );
                  }
                  const slotCount = slotsByDay[cell.dateKey]?.length ?? 0;
                  const reservationCount = reservationsByDay[cell.dateKey]?.length ?? 0;
                  const isSelected = selectedDayKey === cell.dateKey;
                  return (
                    <button
                      key={cell.dateKey}
                      type="button"
                      className={`calendar-day${isSelected ? ' calendar-day--selected' : ''}`}
                      onClick={() => setSelectedDayKey(cell.dateKey)}
                    >
                      <span className="calendar-day-number">{cell.dayOfMonth}</span>
                      {slotCount > 0 && (
                        <span className="calendar-day-indicator calendar-day-indicator--slot">
                          {slotCount} {slotsTitle}
                        </span>
                      )}
                      {reservationCount > 0 && (
                        <span className="calendar-day-indicator calendar-day-indicator--booking">
                          {reservationCount} {reservationsTitle}
                        </span>
                      )}
                    </button>
                  );
                }),
              )}
            </section>

            <section className="dashboard-card calendar-day-details">
              <h2 className="dashboard-section-title calendar-day-details-title">{dayDetailsTitle}</h2>
              <p className="dashboard-card-meta calendar-day-details-meta">
                {selectedDayLabel}: {formatDateLabel(selectedDayDate)}
              </p>

              {loading ? (
                <p className="dashboard-loading">{dictionary.admin?.loading ?? 'Loading...'}</p>
              ) : selectedDaySlots.length === 0 && selectedDayReservations.length === 0 ? (
                <p className="dashboard-empty">{noItemsForDay}</p>
              ) : (
                <>
                  <h3 className="dashboard-section-title" style={{ fontSize: '0.95rem' }}>
                    {slotsTitle}
                  </h3>
                  {selectedDaySlots.length === 0 ? (
                    <p className="dashboard-empty">{noSlotsForDay}</p>
                  ) : (
                    <ul className="calendar-slot-list">
                      {selectedDaySlots.map((slot) => {
                        const start = new Date(slot.startAt);
                        const end = new Date(slot.endAt);
                        return (
                          <li
                            key={slot.id}
                            className={`calendar-slot-item calendar-slot-item--${slot.status}`}
                          >
                            <div className="calendar-slot-info">
                              <span className="calendar-slot-time">
                                {formatDateLabel(start)} {formatTimeLabel(start)} - {formatTimeLabel(end)}
                              </span>
                              <span className="calendar-slot-status">
                                {slot.status} | {slot.supportsOnline ? onlineText : ''}
                                {slot.supportsOnline && slot.supportsOffline ? ' + ' : ''}
                                {slot.supportsOffline ? offlineText : ''}
                              </span>
                            </div>
                            <div className="calendar-slot-actions">
                              {slot.status === 'available' && (
                                <button
                                  type="button"
                                  className="dashboard-btn dashboard-btn--small"
                                  onClick={() => void updateSlotStatus(slot.id, 'blocked')}
                                >
                                  {cp.block ?? 'Block'}
                                </button>
                              )}
                              {slot.status === 'blocked' && (
                                <button
                                  type="button"
                                  className="dashboard-btn dashboard-btn--small"
                                  onClick={() => void updateSlotStatus(slot.id, 'available')}
                                >
                                  {cp.unblock ?? 'Unblock'}
                                </button>
                              )}
                              {(slot.status === 'available' || slot.status === 'blocked') && (
                                <button
                                  type="button"
                                  className="dashboard-btn dashboard-btn--small dashboard-btn--danger"
                                  onClick={() => void removeSlot(slot.id)}
                                >
                                  {cp.remove ?? 'Remove'}
                                </button>
                              )}
                            </div>
                          </li>
                        );
                      })}
                    </ul>
                  )}

                  <h3 className="dashboard-section-title" style={{ fontSize: '0.95rem', marginTop: '1rem' }}>
                    {reservationsTitle}
                  </h3>
                  {selectedDayReservations.length === 0 ? (
                    <p className="dashboard-empty">{noReservationsForDay}</p>
                  ) : (
                    <ul className="calendar-booking-list">
                      {selectedDayReservations.map((r) => (
                        <li key={r.id} className="calendar-booking-item">
                          <div className="calendar-booking-info">
                            <span>{r.serviceTitle ?? 'Reservation'}</span>
                            {' - '}
                            <span>
                              {r.mode === 'online'
                                ? `${onlineText} (${r.onlineType ?? 'voice'})`
                                : offlineText}
                            </span>
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
                </>
              )}
            </section>
          </section>

          <aside className="calendar-sidebar">
            <section className="dashboard-card">
              <h2 className="dashboard-section-title" style={{ fontSize: '1rem' }}>
                {settingsTitle}
              </h2>
              <p className="dashboard-card-meta" style={{ marginBottom: '0.75rem' }}>
                {settingsDescription}
              </p>
              {profileError && <p className="dashboard-error">{profileError}</p>}
              <div className="reservation-settings-grid">
                <label className="dashboard-card-meta reservation-settings-checkbox">
                  <input
                    type="checkbox"
                    checked={autoAccept}
                    onChange={(e) => setAutoAccept(e.target.checked)}
                  />
                  {' '}Auto-accept requests when slot is still free
                </label>
                <label className="dashboard-card-meta">
                Voice session fixed price (USD)
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
                Video session fixed price (USD)
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
                Offline session fixed price (USD)
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
                  {profileSaving ? 'Saving...' : saveSettings}
                </button>
              </div>
            </section>

            <section className="dashboard-card">
              <h2 className="dashboard-section-title" style={{ fontSize: '1rem' }}>
                {addSlotTitle}
              </h2>
              <p className="dashboard-card-meta" style={{ marginBottom: '0.75rem' }}>
                {addSlotForDay}: {formatDateLabel(selectedDayDate)}
              </p>
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
                <label className="dashboard-card-meta reservation-settings-checkbox">
                  <input
                    type="checkbox"
                    checked={supportsOnline}
                    onChange={(e) => setSupportsOnline(e.target.checked)}
                  />
                  {' '}{onlineText}
                </label>
                <label className="dashboard-card-meta reservation-settings-checkbox">
                  <input
                    type="checkbox"
                    checked={supportsOffline}
                    onChange={(e) => setSupportsOffline(e.target.checked)}
                  />
                  {' '}{offlineText}
                </label>
                <button type="submit" className="dashboard-primary-btn" disabled={saving}>
                  {saving ? '...' : dictionary.calendarPage?.addSlot ?? 'Add Slot'}
                </button>
              </form>
            </section>
          </aside>
        </div>
      </Container>
    </main>
  );
};
