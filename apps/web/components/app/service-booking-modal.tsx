'use client';

import type { ReservationProfile, ReservationSlot, ServiceSearchResult } from '@mohandishub/shared';
import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import { useProfileModal } from './profile-modal-context';

import { useAppStatus } from '@/components/app-status-provider';
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

const isSameDay = (a: Date, b: Date): boolean =>
  a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

function formatSlot(slot: ReservationSlot, localeTag?: string): string {
  const start = new Date(slot.startAt);
  const end = new Date(slot.endAt);
  return (
    start.toLocaleDateString(localeTag, {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
    }) +
    ' ' +
    start.toLocaleTimeString(localeTag, { hour: '2-digit', minute: '2-digit' }) +
    ' - ' +
    end.toLocaleTimeString(localeTag, { hour: '2-digit', minute: '2-digit' })
  );
}

export const ServiceBookingModal = ({
  open,
  onClose,
  service,
  accessToken,
  locale = 'en',
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
  const { status } = useAppStatus();
  const tr = (en: string, ar: string) => (locale === 'ar' ? ar : en);
  const localeTag = locale === 'ar' ? 'ar-EG' : undefined;

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

      const upcomingSlots = dedupeSlotsById(slotsRes.items)
        .sort((a, b) => new Date(a.startAt).getTime() - new Date(b.startAt).getTime());

      setSlots(upcomingSlots);
      setProfile(profileRes);

      const onlineSupported = upcomingSlots.some((slot) => slot.supportsOnline);
      const offlineSupported = upcomingSlots.some((slot) => slot.supportsOffline);
      setMode((current) => {
        const modeSupported = current === 'online' ? onlineSupported : offlineSupported;
        if (!modeSupported) {
          return onlineSupported ? 'online' : offlineSupported ? 'offline' : current;
        }
        return current;
      });

      setModeReady(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : tr('Failed to load slots', 'فشل تحميل المواعيد'));
      setSlots([]);
      setProfile(null);
      setModeReady(true);
    } finally {
      setLoading(false);
    }
  }, [accessToken, service.providerId]);

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
    if (mode === 'online' && !slot.supportsOnline) return false;
    if (mode === 'offline' && !slot.supportsOffline) return false;

    const slotStart = new Date(slot.startAt);

    switch (slotFilter) {
      case 'today':
        return isSameDay(slotStart, now);
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
      window.dispatchEvent(new CustomEvent('wallet-updated'));
      onSuccess?.();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : tr('Booking failed', 'فشل الحجز'));
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
    serviceBookingCopy?.noSlots ??
    tr(
      'This expert has no available upcoming slots right now.',
      'لا توجد مواعيد متاحة قادمة لهذا الخبير حالياً.',
    );
  const noFilteredSlots =
    serviceBookingCopy?.noFilteredSlots ??
    tr('No available slots match the selected filter.', 'لا توجد مواعيد متاحة تطابق الفلتر المحدد.');
  const modePrice =
    mode === 'offline'
      ? profile?.offlinePrice ?? null
      : onlineType === 'video'
        ? profile?.onlineVideoPrice ?? null
        : profile?.onlineVoicePrice ?? null;
  const platformFee = Math.max(0, status?.reservationAcceptanceFee ?? 0);
  const servicePrice = service.price ?? 0;
  const totalPrice = modePrice != null ? servicePrice + modePrice + platformFee : null;

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
              {tr('Platform verified', 'موثّق من المنصة')}
            </span>
          )}
        </p>
        {service.price != null && <p className="service-booking-price">{service.price} {service.currency ?? 'EGP'}</p>}

        <div className="service-booking-mode-row">
          {modeReady ? (
            <>
              <div className="service-booking-mode-group">
                <button
                  type="button"
                  className={`dashboard-btn ${mode === 'online' ? 'dashboard-btn--primary' : 'dashboard-btn--secondary'}`}
                  onClick={() => setMode('online')}
                >
                  {tr('Online', 'أونلاين')}
                </button>
                <button
                  type="button"
                  className={`dashboard-btn ${mode === 'offline' ? 'dashboard-btn--primary' : 'dashboard-btn--secondary'}`}
                  onClick={() => setMode('offline')}
                >
                  {tr('Offline', 'حضوري')}
                </button>
              </div>
              {mode === 'online' && (
                <>
                  <span className="service-booking-mode-separator" aria-hidden="true" />
                  <div className="service-booking-mode-group">
                    <button
                      type="button"
                      className={`dashboard-btn ${onlineType === 'voice' ? 'dashboard-btn--primary' : 'dashboard-btn--secondary'}`}
                      onClick={() => setOnlineType('voice')}
                    >
                      {tr('Voice', 'صوتي')}
                    </button>
                    <button
                      type="button"
                      className={`dashboard-btn ${onlineType === 'video' ? 'dashboard-btn--primary' : 'dashboard-btn--secondary'}`}
                      onClick={() => setOnlineType('video')}
                    >
                      {tr('Video', 'فيديو')}
                    </button>
                  </div>
                </>
              )}
            </>
          ) : (
            <span style={{ color: 'hsl(var(--muted-foreground))', fontSize: '0.9rem' }}>
              {common.continue ?? tr('Loading...', 'جاري التحميل...')}
            </span>
          )}
        </div>
        {modePrice != null && (
          <p className="service-booking-price" style={{ marginTop: '-0.5rem' }}>
            {tr('Reservation price', 'سعر الحجز')}: {modePrice.toFixed(2)} EGP
          </p>
        )}
        {totalPrice != null && (
          <div className="reservation-note-box" style={{ marginBottom: '0.75rem' }}>
            <p>{tr('Service price', 'سعر الخدمة')}: {servicePrice.toFixed(2)} EGP</p>
            <p>{tr('Reservation type price', 'سعر نوع الحجز')}: {modePrice!.toFixed(2)} EGP</p>
            <p>{tr('Platform fee', 'رسوم المنصة')}: {platformFee.toFixed(2)} EGP</p>
            <p>
              <strong>{tr('Total', 'الإجمالي')}: {totalPrice.toFixed(2)} EGP</strong>
            </p>
          </div>
        )}
        <div className="reservation-note-box" style={{ marginBottom: '0.75rem' }}>
          <p>
            {tr(
              'Cancellation policy snapshot is locked at booking time.',
              'يتم تثبيت نسخة سياسة الإلغاء وقت الحجز.',
            )}
          </p>
          <p>
            {tr(
              'Customer cancellation more than 24 hours before start refunds the fixed reservation hold.',
              'إلغاء العميل قبل أكثر من 24 ساعة من البداية يعيد مبلغ الحجز الثابت.',
            )}
          </p>
          <p>
            {tr(
              'Provider cancellation inside 2 hours of start may trigger a penalty.',
              'إلغاء مقدم الخدمة خلال ساعتين من وقت البداية قد يترتب عليه غرامة.',
            )}
          </p>
        </div>

        <div className="service-booking-slots">
          <div style={{ marginBottom: '0.75rem', display: 'grid', gap: '0.35rem' }}>
            <label htmlFor="service-booking-filter" style={{ fontSize: '0.9rem', fontWeight: 600 }}>
              {tr('Filter slots', 'تصفية المواعيد')}
            </label>
            <select
              id="service-booking-filter"
              className="dashboard-select service-booking-filter-select"
              value={slotFilter}
              onChange={(e) =>
                setSlotFilter(
                  e.target.value as 'today' | 'next7Days' | 'thisMonth' | 'allUpcoming',
                )
              }
            >
              <option value="today">{tr('Today', 'اليوم')}</option>
              <option value="next7Days">{tr('Next 7 days', 'الـ 7 أيام القادمة')}</option>
              <option value="thisMonth">{tr('This month', 'هذا الشهر')}</option>
              <option value="allUpcoming">{tr('All upcoming', 'كل المواعيد القادمة')}</option>
            </select>
            <p style={{ margin: 0, fontSize: '0.85rem', color: 'hsl(var(--muted-foreground))' }}>
              {slotFilter === 'allUpcoming'
                ? tr('Showing upcoming slots from now.', 'عرض المواعيد القادمة من الآن.')
                : tr('Showing available slots for the selected range.', 'عرض المواعيد المتاحة للنطاق المحدد.')}
            </p>
          </div>

          {loading ? (
            <p>{common.continue ?? tr('Loading...', 'جاري التحميل...')}</p>
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
                  {formatSlot(slot, localeTag)}
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
