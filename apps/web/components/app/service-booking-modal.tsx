'use client';

import type { ReservationProfile, ReservationSlot, ServiceSearchResult } from '@mohandishub/shared';
import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

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
  const [modeReady, setModeReady] = useState(false);
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
      setSlots(dedupeSlotsById(slotsRes.items));
      setProfile(profileRes);
      const onlineSupported = slotsRes.items.some((s) => s.supportsOnline);
      const offlineSupported = slotsRes.items.some((s) => s.supportsOffline);
      const modeSupported = mode === 'online' ? onlineSupported : offlineSupported;
      if (!modeSupported) {
        const otherSupported = mode === 'online' ? offlineSupported : onlineSupported;
        if (otherSupported) {
          setMode(mode === 'online' ? 'offline' : 'online');
        }
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
  }, [accessToken, mode, service.providerId, weekStart]);

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
        setModeReady(false);
      }
      void loadSlots();
    } else {
      prevOpenRef.current = false;
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
          {service.providerName}
          {profile?.verificationBadgeEarned && (
              <span className="profile-screen-badge profile-screen-badge_verified" style={{ marginLeft: '0.5rem' }} title="Completed profile and deposited 1000 USD">
              Verified
            </span>
          )}
        </p>
        {service.price != null && (
          <p className="service-booking-price">{service.price} USD</p>
        )}

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
            <span style={{ color: 'hsl(var(--muted-foreground))', fontSize: '0.9rem' }}>{common.continue ?? 'Loading...'}</span>
          )}
        </div>
        {modePrice != null && (
          <p className="service-booking-price" style={{ marginTop: '-0.5rem' }}>
              Reservation price: {modePrice.toFixed(2)} USD
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

  return typeof document !== 'undefined' ? createPortal(modalContent, document.body) : modalContent;
};
