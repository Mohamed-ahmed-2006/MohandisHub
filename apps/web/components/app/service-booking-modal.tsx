'use client';

import type { ReservationProfile, ReservationSlot, ServiceSearchResult } from '@mohandishub/shared';
import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import { useProfileModal } from './profile-modal-context';

import type { Dictionary, Locale } from '@/lib/i18n/types';
import { reservationsApiClient } from '@/lib/reservations/client';

type Props = {
  open: boolean;
  onClose: () => void;
  service: ServiceSearchResult;
  accessToken: string;
  locale?: Locale;
  dictionary: Dictionary;
  onSuccess?: () => void;
};

const dedupeSlotsById = (items: ReservationSlot[]): ReservationSlot[] => {
  const seen = new Set<string>();
  return items.filter((item) => {
    if (seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  });
};

const getStartOfToday = (): Date => {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  return date;
};

const isUpcomingSlot = (slot: ReservationSlot, now: Date): boolean =>
  new Date(slot.startAt).getTime() >= now.getTime();

function formatSlot(slot: ReservationSlot): string {
  const start = new Date(slot.startAt);
  const end = new Date(slot.endAt);
  return (
    start.toLocaleDateString(undefined, {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
    }) +
    ' ' +
    start.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }) +
    ' - ' +
    end.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
  );
}

export const ServiceBookingModal = ({
  open,
  onClose,
  service,
  accessToken,
  dictionary,
  onSuccess,
}: Props) => {
  const [slots, setSlots] = useState<ReservationSlot[]>([]);
  const [profile, setProfile] = useState<ReservationProfile | null>(null);
  const [loading, setLoading] = useState(false);
  const [booking, setBooking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedSlot, setSelectedSlot] = useState<ReservationSlot | null>(null);
  const [mode, setMode] = useState<'online' | 'offline'>('online');
  const [onlineType, setOnlineType] = useState<'voice' | 'video'>('voice');
  const [slotFilter, setSlotFilter] = useState<'today' | 'next7Days' | 'thisMonth' | 'allUpcoming'>(
    'allUpcoming',
  );
  const [modeReady, setModeReady] = useState(false);
  const { openProfileModal } = useProfileModal();

  const loadSlots = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const start = getStartOfToday();
      const end = new Date(start);
      end.setDate(end.getDate() + 90);

      const [slotsRes, profileRes] = await Promise.all([
        reservationsApiClient.listSlots(accessToken, {
          providerId: service.providerId,
          from: start.toISOString(),
          to: end.toISOString(),
          availableOnly: true,
        }),
        reservationsApiClient.getProviderProfile(accessToken, service.providerId),
      ]);

      const now = new Date();
      const upcomingSlots = dedupeSlotsById(slotsRes.items)
        .filter((slot) => isUpcomingSlot(slot, now))
        .sort((a, b) => new Date(a.startAt).getTime() - new Date(b.startAt).getTime());

      setSlots(upcomingSlots);
      setProfile(profileRes);

      const onlineSupported = upcomingSlots.some((slot) => slot.supportsOnline);
      const offlineSupported = upcomingSlots.some((slot) => slot.supportsOffline);
      const modeSupported = mode === 'online' ? onlineSupported : offlineSupported;

      if (!modeSupported) {
        const fallbackMode = onlineSupported ? 'online' : offlineSupported ? 'offline' : mode;
        setMode(fallbackMode);
      }

      setModeReady(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load slots');
      setSlots([]);
      setProfile(null);
      setModeReady(true);
    } finally {
      setLoading(false);
    }
  }, [accessToken, mode, service.providerId]);

  const prevOpenRef = useRef(false);
  useEffect(() => {
    if (open) {
      const justOpened = !prevOpenRef.current;
      prevOpenRef.current = true;
      if (justOpened) {
        setSelectedSlot(null);
        setError(null);
        setMode('online');
        setOnlineType('voice');
        setSlotFilter('allUpcoming');
        setModeReady(false);
      }
      void loadSlots();
    } else {
      prevOpenRef.current = false;
    }
  }, [open, loadSlots]);

  const now = new Date();
  const startOfToday = getStartOfToday();
  const endOfToday = new Date(startOfToday);
  endOfToday.setDate(endOfToday.getDate() + 1);
  const next7Days = new Date(now);
  next7Days.setDate(next7Days.getDate() + 7);
  const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);

  const filteredSlots = slots.filter((slot) => {
    if (!isUpcomingSlot(slot, now)) return false;
    if (mode === 'online' && !slot.supportsOnline) return false;
    if (mode === 'offline' && !slot.supportsOffline) return false;

    const slotStart = new Date(slot.startAt);

    switch (slotFilter) {
      case 'today':
        return slotStart >= now && slotStart < endOfToday;
      case 'next7Days':
        return slotStart >= now && slotStart < next7Days;
      case 'thisMonth':
        return slotStart >= now && slotStart < endOfMonth;
      case 'allUpcoming':
      default:
        return slotStart >= now;
    }
  });

  useEffect(() => {
    if (selectedSlot && !filteredSlots.some((slot) => slot.id === selectedSlot.id)) {
      setSelectedSlot(null);
    }
  }, [filteredSlots, selectedSlot]);

  const handleBook = async () => {
    if (!selectedSlot || !accessToken) return;
    setBooking(true);
    setError(null);
    try {
      const idempotencyKey = `create-${service.providerId}-${selectedSlot.id}`;
      await reservationsApiClient.createReservation(
        accessToken,
        {
          serviceId: service.id,
          providerId: service.providerId,
          slotId: selectedSlot.id,
          mode,
          ...(mode === 'online' ? { onlineType } : {}),
        },
        idempotencyKey,
      );
      onSuccess?.();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Booking failed');
    } finally {
      setBooking(false);
    }
  };

  const common = dictionary.common ?? {};
  const bookLabel =
    (dictionary as { appHome?: { requestService?: string } }).appHome?.requestService ?? 'Book';
  const serviceBookingCopy = (
    dictionary as {
      serviceBooking?: { noSlots?: string; noFilteredSlots?: string };
    }
  ).serviceBooking;
  const noSlots =
    serviceBookingCopy?.noSlots ?? 'This expert has no available upcoming slots right now.';
  const noFilteredSlots =
    serviceBookingCopy?.noFilteredSlots ?? 'No available slots match the selected filter.';
  const modePrice =
    mode === 'offline'
      ? profile?.offlinePrice ?? null
      : onlineType === 'video'
        ? profile?.onlineVideoPrice ?? null
        : profile?.onlineVoicePrice ?? null;

  if (!open) return null;

  const modalContent = (
    <div
      className="home-drawer-overlay"
      style={{ zIndex: 1100 }}
      onClick={() => {
        onClose();
      }}
    >
      <div className="service-booking-modal" onClick={(e) => e.stopPropagation()}>
        <h2 className="service-booking-title">{service.title}</h2>
        <p className="service-booking-provider">
          <button
            type="button"
            className="service-booking-provider-btn"
            onClick={() =>
              openProfileModal(service.providerId, {
                displayName: service.providerName,
                avatarUrl: service.providerAvatar ?? null,
              })
            }
          >
            {service.providerName}
          </button>
          {profile?.verificationBadgeEarned && (
            <span
              className="profile-screen-badge profile-screen-badge_verified"
              style={{ marginLeft: '0.5rem' }}
              title="Complete profile and 1000 EGP total deposits."
            >
              Platform verified
            </span>
          )}
        </p>
        {service.price != null && <p className="service-booking-price">{service.price} {service.currency ?? 'EGP'}</p>}

        <div style={{ marginBottom: '0.75rem', display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
          {modeReady ? (
            <>
              <button
                type="button"
                className={`dashboard-btn ${mode === 'online' ? 'dashboard-btn--primary' : 'dashboard-btn--secondary'}`}
                onClick={() => setMode('online')}
              >
                Online
              </button>
              <button
                type="button"
                className={`dashboard-btn ${mode === 'offline' ? 'dashboard-btn--primary' : 'dashboard-btn--secondary'}`}
                onClick={() => setMode('offline')}
              >
                Offline
              </button>
              {mode === 'online' && (
                <>
                  <button
                    type="button"
                    className={`dashboard-btn ${onlineType === 'voice' ? 'dashboard-btn--primary' : 'dashboard-btn--secondary'}`}
                    onClick={() => setOnlineType('voice')}
                  >
                    Voice
                  </button>
                  <button
                    type="button"
                    className={`dashboard-btn ${onlineType === 'video' ? 'dashboard-btn--primary' : 'dashboard-btn--secondary'}`}
                    onClick={() => setOnlineType('video')}
                  >
                    Video
                  </button>
                </>
              )}
            </>
          ) : (
            <span style={{ color: 'hsl(var(--muted-foreground))', fontSize: '0.9rem' }}>
              {common.continue ?? 'Loading...'}
            </span>
          )}
        </div>
        {modePrice != null && (
          <p className="service-booking-price" style={{ marginTop: '-0.5rem' }}>
            Reservation price: {modePrice.toFixed(2)} EGP
          </p>
        )}
        <div className="reservation-note-box" style={{ marginBottom: '0.75rem' }}>
          <p>Cancellation policy snapshot is locked at booking time.</p>
          <p>Customer cancellation more than 24 hours before start refunds the fixed reservation hold.</p>
          <p>Provider cancellation inside 2 hours of start may trigger a penalty.</p>
        </div>

        <div className="service-booking-slots">
          <div style={{ marginBottom: '0.75rem', display: 'grid', gap: '0.35rem' }}>
            <label htmlFor="service-booking-filter" style={{ fontSize: '0.9rem', fontWeight: 600 }}>
              Filter slots
            </label>
            <select
              id="service-booking-filter"
              className="dashboard-select"
              value={slotFilter}
              onChange={(e) =>
                setSlotFilter(
                  e.target.value as 'today' | 'next7Days' | 'thisMonth' | 'allUpcoming',
                )
              }
            >
              <option value="today">Today</option>
              <option value="next7Days">Next 7 days</option>
              <option value="thisMonth">This month</option>
              <option value="allUpcoming">All upcoming</option>
            </select>
            <p style={{ margin: 0, fontSize: '0.85rem', color: 'hsl(var(--muted-foreground))' }}>
              Showing only slots from {startOfToday.toLocaleDateString()} onward.
            </p>
          </div>

          {loading ? (
            <p>{common.continue ?? 'Loading...'}</p>
          ) : slots.length === 0 ? (
            <p className="service-booking-empty">{noSlots}</p>
          ) : filteredSlots.length === 0 ? (
            <p className="service-booking-empty">{noFilteredSlots}</p>
          ) : (
            <div className="service-booking-slot-grid">
              {filteredSlots.map((slot) => (
                <button
                  key={slot.id}
                  type="button"
                  className={`service-booking-slot-btn ${selectedSlot?.id === slot.id ? 'service-booking-slot-btn--selected' : ''}`}
                  onClick={() => setSelectedSlot(slot)}
                >
                  {formatSlot(slot)}
                </button>
              ))}
            </div>
          )}
        </div>

        {error && <p className="service-booking-error">{error}</p>}

        <div className="service-booking-actions">
          <button type="button" className="dashboard-btn dashboard-btn--secondary" onClick={onClose}>
            {common.back ?? 'Back'}
          </button>
          <button
            type="button"
            className="dashboard-btn dashboard-btn--primary"
            disabled={!selectedSlot || booking}
            onClick={() => void handleBook()}
          >
            {booking ? '...' : bookLabel}
          </button>
        </div>
      </div>
    </div>
  );

  return typeof document !== 'undefined' ? createPortal(modalContent, document.body) : modalContent;
};
