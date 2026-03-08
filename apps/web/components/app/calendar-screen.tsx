'use client';

import type { AvailabilitySlot, Booking } from '@mohandishub/shared';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';

import { useAuth } from '@/components/auth/auth-provider';
import { Container } from '@/components/ui/container';
import { availabilityApiClient } from '@/lib/availability/client';
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

export const CalendarScreen = ({ locale, dictionary }: Props) => {
  const router = useRouter();
  const { authUser, accessToken, isAuthenticated, isReady, authGuard } = useAuth();
  const [slots, setSlots] = useState<AvailabilitySlot[]>([]);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [weekStart, setWeekStart] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() - d.getDay());
    d.setHours(0, 0, 0, 0);
    return d;
  });
  const [showAddSlot, setShowAddSlot] = useState(false);
  const [addStart, setAddStart] = useState('');
  const [addEnd, setAddEnd] = useState('');
  const [saving, setSaving] = useState(false);
  const [updatingBookingId, setUpdatingBookingId] = useState<string | null>(null);

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
      router.replace(buildLocalePath(locale, '/app'));
      return;
    }
  }, [isReady, isAuthenticated, authUser, authGuard.emailVerified, locale, router]);

  const load = useCallback(async () => {
    if (!accessToken) return;
    setLoading(true);
    setError(null);
    try {
      const start = new Date(weekStart);
      const end = new Date(weekStart);
      end.setDate(end.getDate() + 7);
      const [slotsRes, bookingsRes] = await Promise.all([
        availabilityApiClient.listSlots(accessToken, {
          from: start.toISOString(),
          to: end.toISOString(),
          availableOnly: false,
        }),
        bookingsApiClient.listMy(accessToken, { role: 'provider', page: 1, limit: 50 }),
      ]);
      setSlots(slotsRes.items);
      setBookings(bookingsRes.items);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, [accessToken, weekStart]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleUpdateBookingStatus = useCallback(
    async (bookingId: string, status: string) => {
      if (!accessToken) return;
      setUpdatingBookingId(bookingId);
      try {
        await bookingsApiClient.update(accessToken, bookingId, { status });
        void load();
      } catch {
        /* ignore */
      } finally {
        setUpdatingBookingId(null);
      }
    },
    [accessToken, load],
  );

  const handlePrevWeek = () => {
    const d = new Date(weekStart);
    d.setDate(d.getDate() - 7);
    setWeekStart(d);
  };

  const handleNextWeek = () => {
    const d = new Date(weekStart);
    d.setDate(d.getDate() + 7);
    setWeekStart(d);
  };

  const handleAddSlot = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!accessToken || !addStart || !addEnd) return;
    setSaving(true);
    try {
      await availabilityApiClient.createSlot(accessToken, {
        startAt: new Date(addStart).toISOString(),
        endAt: new Date(addEnd).toISOString(),
      });
      setShowAddSlot(false);
      setAddStart('');
      setAddEnd('');
      void load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to add slot');
    } finally {
      setSaving(false);
    }
  };

  const handleBlockSlot = async (id: string) => {
    if (!accessToken) return;
    try {
      await availabilityApiClient.updateSlot(accessToken, id, { status: 'blocked' });
      void load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to update');
    }
  };

  const handleUnblockSlot = async (id: string) => {
    if (!accessToken) return;
    try {
      await availabilityApiClient.updateSlot(accessToken, id, { status: 'available' });
      void load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to update');
    }
  };

  const handleDeleteSlot = async (id: string) => {
    if (!accessToken) return;
    try {
      await availabilityApiClient.deleteSlot(accessToken, id);
      void load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to delete');
    }
  };

  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekEnd.getDate() + 6);
  const cp = dictionary.calendarPage ?? {};
  const title = cp.title ?? 'Calendar';
  const addSlot = cp.addSlot ?? 'Add slot';
  const noSlots = cp.noSlots ?? 'No slots this week. Add one to get started.';
  const booked = cp.booked ?? 'Booked';
  const available = cp.available ?? 'Available';
  const blocked = cp.blocked ?? 'Blocked';
  const block = cp.block ?? 'Block';
  const unblock = cp.unblock ?? 'Unblock';
  const remove = cp.remove ?? 'Remove';
  const prevWeek = cp.prevWeek ?? 'Previous week';
  const nextWeek = cp.nextWeek ?? 'Next week';

  return (
    <main className="profile-screen-main">
      <Container className="profile-screen-container">
        <h1 className="dashboard-title">{title}</h1>
        {error && <p className="dashboard-error">{error}</p>}

        <div className="calendar-toolbar motion-reveal">
          <button type="button" className="dashboard-btn dashboard-btn--secondary" onClick={handlePrevWeek}>
            ← {prevWeek}
          </button>
          <span className="calendar-week-label">
            {formatDate(weekStart.toISOString())} – {formatDate(weekEnd.toISOString())}
          </span>
          <button type="button" className="dashboard-btn dashboard-btn--secondary" onClick={handleNextWeek}>
            {nextWeek} →
          </button>
          <button
            type="button"
            className="dashboard-btn dashboard-btn--primary"
            onClick={() => setShowAddSlot(true)}
          >
            + {addSlot}
          </button>
        </div>

        {showAddSlot && (
          <form onSubmit={(e) => { e.preventDefault(); void handleAddSlot(e); }} className="calendar-add-form motion-reveal">
            <label>
              Start: <input type="datetime-local" value={addStart} onChange={(e) => setAddStart(e.target.value)} required />
            </label>
            <label>
              End: <input type="datetime-local" value={addEnd} onChange={(e) => setAddEnd(e.target.value)} required />
            </label>
            <div>
              <button type="submit" className="dashboard-btn dashboard-btn--primary" disabled={saving}>
                {saving ? '...' : dictionary.common.save}
              </button>
              <button type="button" className="dashboard-btn dashboard-btn--secondary" onClick={() => setShowAddSlot(false)}>
                {dictionary.common.back}
              </button>
            </div>
          </form>
        )}

        {loading ? (
          <p className="dashboard-loading">{dictionary.common.continue}</p>
        ) : (
          <div className="calendar-slots motion-reveal">
            {slots.length === 0 ? (
              <p className="dashboard-empty">{noSlots}</p>
            ) : (
              <ul className="calendar-slot-list">
                {slots.map((slot) => (
                  <li
                    key={slot.id}
                    className={`calendar-slot-item calendar-slot-item--${slot.status}`}
                  >
                    <div className="calendar-slot-info">
                      <span className="calendar-slot-time">
                        {formatDate(slot.startAt)} {formatTime(slot.startAt)} – {formatTime(slot.endAt)}
                      </span>
                      <span className="calendar-slot-status">
                        {slot.status === 'booked' ? booked : slot.status === 'blocked' ? blocked : available}
                      </span>
                    </div>
                    <div className="calendar-slot-actions">
                      {slot.status === 'available' && (
                        <button
                          type="button"
                          className="dashboard-btn dashboard-btn--small"
                          onClick={() => void handleBlockSlot(slot.id)}
                        >
                          {block}
                        </button>
                      )}
                      {slot.status === 'blocked' && (
                        <button
                          type="button"
                          className="dashboard-btn dashboard-btn--small"
                          onClick={() => void handleUnblockSlot(slot.id)}
                        >
                          {unblock}
                        </button>
                      )}
                      {(slot.status === 'available' || slot.status === 'blocked') && (
                        <button
                          type="button"
                          className="dashboard-btn dashboard-btn--small dashboard-btn--danger"
                          onClick={() => void handleDeleteSlot(slot.id)}
                        >
                          {remove}
                        </button>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {bookings.length > 0 && (
          <section className="calendar-bookings motion-reveal">
            <h2>{cp.upcomingBookings ?? 'Upcoming bookings'}</h2>
            <ul className="calendar-booking-list">
              {bookings.slice(0, 10).map((b) => (
                <li key={b.id} className="calendar-booking-item">
                  <div className="calendar-booking-info">
                    <span>{b.serviceTitle ?? 'Booking'}</span> — <span>{b.customerName ?? 'Customer'}</span> — {formatDate(b.slotStartAt ?? b.createdAt)} {b.slotStartAt ? formatTime(b.slotStartAt) : ''}
                    <span className={`calendar-booking-status calendar-booking-status--${b.status}`}>
                      {b.status}
                    </span>
                  </div>
                  <div className="calendar-booking-actions">
                    {(b.status === 'paid' || b.status === 'scheduled') && (
                      <button
                        type="button"
                        className="dashboard-btn dashboard-btn--small dashboard-btn--primary"
                        onClick={() => void handleUpdateBookingStatus(b.id, 'in_progress')}
                        disabled={updatingBookingId === b.id}
                      >
                        {updatingBookingId === b.id ? '...' : (cp.start ?? 'Start')}
                      </button>
                    )}
                    {b.status === 'in_progress' && (
                      <button
                        type="button"
                        className="dashboard-btn dashboard-btn--small dashboard-btn--primary"
                        onClick={() => void handleUpdateBookingStatus(b.id, 'completed')}
                        disabled={updatingBookingId === b.id}
                      >
                        {updatingBookingId === b.id ? '...' : (cp.complete ?? 'Complete')}
                      </button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </section>
        )}
      </Container>
    </main>
  );
};
