'use client';

import type { ReservationProfile, ReservationSlot, ServiceSearchResult } from '@mohandishub/shared';
import { useCallback, useEffect, useState } from 'react';

import { reservationsApiClient } from '@/lib/reservations/client';
import type { Dictionary, Locale } from '@/lib/i18n/types';

type Props = {
  open: boolean;
  onClose: () => void;
  service: ServiceSearchResult;
  accessToken: string;
  locale?: Locale;
  dictionary: Dictionary;
  onSuccess?: () => void;
};

function formatSlot(slot: ReservationSlot): string {
  const start = new Date(slot.startAt);
  const end = new Date(slot.endAt);
  return start.toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  }) + ' ' + start.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }) +
    ' – ' + end.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
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
  const [weekStart, setWeekStart] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() - d.getDay());
    d.setHours(0, 0, 0, 0);
    return d;
  });

  const loadSlots = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const start = new Date(weekStart);
      const end = new Date(weekStart);
      end.setDate(end.getDate() + 14);
      const [slotsRes, profileRes] = await Promise.all([
        reservationsApiClient.listSlots(accessToken, {
          providerId: service.providerId,
          from: start.toISOString(),
          to: end.toISOString(),
          availableOnly: true,
        }),
        reservationsApiClient.getProviderProfile(accessToken, service.providerId),
      ]);
      setSlots(slotsRes.items);
      setProfile(profileRes);
      const modeSupported = mode === 'online' ? slotsRes.items.some((s) => s.supportsOnline) : slotsRes.items.some((s) => s.supportsOffline);
      if (!modeSupported) {
        setMode(mode === 'online' ? 'offline' : 'online');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load slots');
      setSlots([]);
      setProfile(null);
    } finally {
      setLoading(false);
    }
  }, [accessToken, mode, service.providerId, weekStart]);

  useEffect(() => {
    if (open) {
      setSelectedSlot(null);
      setError(null);
      setMode('online');
      setOnlineType('voice');
      void loadSlots();
    }
  }, [open, loadSlots]);

  const handleBook = async () => {
    if (!selectedSlot || !accessToken) return;
    setBooking(true);
    setError(null);
    try {
      await reservationsApiClient.createReservation(accessToken, {
        serviceId: service.id,
        providerId: service.providerId,
        slotId: selectedSlot.id,
        mode,
        ...(mode === 'online' ? { onlineType } : {}),
      });
      onSuccess?.();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Booking failed');
    } finally {
      setBooking(false);
    }
  };

  const common = dictionary.common ?? {};
  const bookLabel = (dictionary as { appHome?: { requestService?: string } }).appHome?.requestService ?? 'Book';
  const noSlots = (dictionary as { calendarPage?: { noSlots?: string } }).calendarPage?.noSlots ?? 'No available slots. Try another week.';
  const modePrice =
    mode === 'offline'
      ? profile?.offlinePrice ?? null
      : onlineType === 'video'
        ? profile?.onlineVideoPrice ?? null
        : profile?.onlineVoicePrice ?? null;

  if (!open) return null;

  return (
    <div className="home-drawer-overlay" onClick={onClose}>
      <div className="service-booking-modal" onClick={(e) => e.stopPropagation()}>
        <h2 className="service-booking-title">{service.title}</h2>
        <p className="service-booking-provider">{service.providerName}</p>
        {service.price != null && (
          <p className="service-booking-price">{service.price} EGP</p>
        )}

        <div style={{ marginBottom: '0.75rem', display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
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
        </div>
        {modePrice != null && (
          <p className="service-booking-price" style={{ marginTop: '-0.5rem' }}>
            Reservation price: {modePrice.toFixed(2)} EGP
          </p>
        )}

        <div className="service-booking-slots">
          <div className="service-booking-week-nav">
            <button type="button" onClick={() => setWeekStart((d) => { const n = new Date(d); n.setDate(n.getDate() - 7); return n; })}>
              ←
            </button>
            <span>{weekStart.toLocaleDateString(undefined, { month: 'long' })}</span>
            <button type="button" onClick={() => setWeekStart((d) => { const n = new Date(d); n.setDate(n.getDate() + 7); return n; })}>
              →
            </button>
          </div>

          {loading ? (
            <p>{common.continue ?? 'Loading...'}</p>
          ) : slots.length === 0 ? (
            <p className="service-booking-empty">{noSlots}</p>
          ) : (
            <div className="service-booking-slot-grid">
              {slots
                .filter((slot) => (mode === 'online' ? slot.supportsOnline : slot.supportsOffline))
                .map((slot) => (
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
};
