'use client';

import type {
  Reservation,
  ReservationCallSnapshot,
  ReservationLocationProposal,
  ReservationTimelineEvent,
} from '@mohandishub/shared';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { OnlineCallModal } from './online-call-modal';

import { useAuth } from '@/components/auth/auth-provider';
import { Container } from '@/components/ui/container';
import { useI18n } from '@/lib/i18n/context';
import { buildLocalePath } from '@/lib/i18n/path';
import { reservationsApiClient } from '@/lib/reservations/client';
import { reviewsApiClient } from '@/lib/reviews/client';

import '@/app/dashboard.css';

type Props = Record<string, never>;

type CheckinCodeState = {
  myCode: string;
  expiresAt: string;
  myVerifiedAt: string | null;
  counterpartyVerifiedAt: string | null;
};

const statusLabels: Record<string, string> = {
  pending: 'Pending decision',
  accepted: 'Accepted',
  awaiting_start: 'Awaiting start',
  in_session: 'In session',
  waiting_customer_done: 'Waiting customer done',
  completed: 'Completed',
  rejected: 'Rejected',
  disputed: 'Disputed',
  cancelled: 'Cancelled',
  expired: 'Expired',
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

function formatMoney(value: number): string {
  return `${value.toFixed(2)} USD`;
}

function isInterviewReservation(reservation: Reservation): boolean {
  return reservation.purpose === 'job_interview';
}

function getReservationTitle(reservation: Reservation): string {
  if (isInterviewReservation(reservation)) {
    return reservation.serviceTitle ? `Interview: ${reservation.serviceTitle}` : 'Job Interview';
  }
  return reservation.serviceTitle ?? 'Reservation';
}

function getReservationModeLabel(reservation: Reservation): string {
  if (reservation.mode === 'online') {
    return isInterviewReservation(reservation)
      ? `Online interview ${reservation.onlineType ?? 'video'}`
      : `Online ${reservation.onlineType ?? 'voice'}`;
  }
  return isInterviewReservation(reservation) ? 'Offline interview' : 'Offline';
}

function timelineSteps(reservation: Reservation): string[] {
  if (reservation.status === 'rejected' || reservation.status === 'cancelled' || reservation.status === 'expired') {
    return ['pending', reservation.status];
  }
  if (reservation.status === 'disputed') {
    return ['pending', 'accepted', 'disputed'];
  }
  return ['pending', 'accepted', 'in_session', 'waiting_customer_done', 'completed'];
}

function reachedStep(currentStatus: string, step: string): boolean {
  const order = ['pending', 'accepted', 'awaiting_start', 'in_session', 'waiting_customer_done', 'completed'];
  const currentIndex = Math.max(order.indexOf(currentStatus), 0);
  const stepIndex = Math.max(order.indexOf(step), 0);
  return currentIndex >= stepIndex;
}

function canCancelReservation(reservation: Reservation): boolean {
  return ['pending', 'accepted', 'awaiting_start'].includes(reservation.status);
}

function describeSettlement(reservation: Reservation): string {
  switch (reservation.settlementStatus) {
    case 'held':
      return 'Customer funds are currently held.';
    case 'released_to_provider':
      return 'Held funds were released to the provider/business.';
    case 'refunded_to_customer':
      return 'Held funds were returned to the customer/expert.';
    case 'cancelled_no_refund':
      return 'Reservation was cancelled without automatic refund.';
    case 'partially_refunded':
      return 'Reservation settled with a partial refund.';
    default:
      return 'No money is currently held.';
  }
}

function getCancellationPreview(reservation: Reservation, viewerId: string): string | null {
  if (!canCancelReservation(reservation)) return null;
  if (reservation.status === 'pending') {
    return 'Cancelling now will close the request without additional charges.';
  }

  const hoursUntilStart =
    (new Date(reservation.requestedStartAt).getTime() - Date.now()) / (1000 * 60 * 60);
  const viewerIsCustomer = reservation.customerId === viewerId;
  const policy = reservation.policySnapshot;

  if (reservation.purpose === 'job_interview') {
    return viewerIsCustomer
      ? 'Cancelling this interview usually keeps the interview fee captured unless the business or platform failed.'
      : 'Cancelling this interview returns the interview fee to the expert.';
  }

  if (!policy) return 'Cancellation outcome will be applied from the reservation policy snapshot.';

  if (viewerIsCustomer) {
    return hoursUntilStart >= policy.customerFreeCancelHours
      ? `Free cancellation window is still open. The fixed reservation hold will be refunded.`
      : `Free cancellation window has passed. The fixed reservation amount will be released to the provider.`;
  }

  return hoursUntilStart >= policy.providerPenaltyCancelHours
    ? 'Cancelling now refunds the customer with no provider penalty.'
    : `Cancelling now refunds the customer and applies a provider penalty of ${formatMoney(policy.providerLateCancelPenaltyAmount)}.`;
}

function cancellationOutcomeLabel(outcome: string): string {
  const labels: Record<string, string> = {
    refunded_to_customer: 'Refunded to customer',
    released_to_provider: 'Released to provider',
    partially_refunded: 'Partially refunded',
    cancelled_no_refund: 'Cancelled (no refund)',
    held: 'Funds held',
  };
  return labels[outcome] ?? outcome.replaceAll('_', ' ');
}

function formatTimelineMetadata(metadata: Record<string, unknown> | null | undefined): string {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return '';
  const formatVal = (v: unknown): string => {
    if (v == null || v === '') return '';
    if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') return String(v);
    if (v instanceof Date) return v.toLocaleString();
    if (Array.isArray(v)) return v.map(formatVal).filter(Boolean).join(', ');
    if (typeof v === 'object') {
      return Object.entries(v as Record<string, unknown>)
        .filter(([, val]) => val != null && val !== '')
        .map(([key, val]) => `${key.replace(/_/g, ' ')}: ${formatVal(val)}`)
        .join('; ');
    }
    return String(v);
  };
  return Object.entries(metadata)
    .filter(([, v]) => v != null && v !== '')
    .map(([k, v]) => {
      const key = k.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
      return `${key}: ${formatVal(v)}`;
    })
    .join(' · ');
}

export const BookingsScreen = (_props: Props) => {
  const { locale, dictionary } = useI18n();
  const router = useRouter();
  const { authUser, accessToken, isAuthenticated, isReady, authGuard } = useAuth();
  const [reservations, setReservations] = useState<Reservation[]>([]);
  const [loading, setLoading] = useState(true);
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [callReservation, setCallReservation] = useState<Reservation | null>(null);

  const [selectedReservation, setSelectedReservation] = useState<Reservation | null>(null);
  const [detailsLoading, setDetailsLoading] = useState(false);
  const [locationProposals, setLocationProposals] = useState<ReservationLocationProposal[]>([]);
  const [locationText, setLocationText] = useState('');
  const [checkinInfo, setCheckinInfo] = useState<CheckinCodeState | null>(null);
  const [counterpartyCode, setCounterpartyCode] = useState('');
  const [callSnapshot, setCallSnapshot] = useState<ReservationCallSnapshot | null>(null);
  const [timeline, setTimeline] = useState<ReservationTimelineEvent[]>([]);
  const [filterStatus, setFilterStatus] = useState<string>('all');
  const [reviewingReservationId, setReviewingReservationId] = useState<string | null>(null);
  const [reviewRating, setReviewRating] = useState(5);
  const [reviewComment, setReviewComment] = useState('');
  const [reviewSubmitting, setReviewSubmitting] = useState(false);
  const [reviewedReservationIds, setReviewedReservationIds] = useState<Set<string>>(new Set());
  const [showCancelModal, setShowCancelModal] = useState(false);

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
    setError(null);
    try {
      const requests =
        authUser?.role === 'expert'
          ? [
              reservationsApiClient.listMyReservations(accessToken, {
                role: 'provider',
                page: 1,
                limit: 80,
              }),
              reservationsApiClient.listMyReservations(accessToken, {
                role: 'customer',
                page: 1,
                limit: 80,
              }),
            ]
          : [
              reservationsApiClient.listMyReservations(accessToken, {
                role: authUser?.role === 'business' ? 'provider' : 'customer',
                page: 1,
                limit: 80,
              }),
            ];
      const responses = await Promise.all(requests);
      const merged = responses
        .flatMap((response) => response.items)
        .filter((item, index, array) => array.findIndex((candidate) => candidate.id === item.id) === index)
        .sort((a, b) => new Date(b.requestedStartAt).getTime() - new Date(a.requestedStartAt).getTime());

      setReservations(merged);
      if (selectedReservation) {
        const refreshed = merged.find((item) => item.id === selectedReservation.id) ?? null;
        setSelectedReservation(refreshed);
      }
    } catch (e) {
      setReservations([]);
      setError(e instanceof Error ? e.message : 'Failed to load reservations');
    } finally {
      setLoading(false);
    }
  }, [accessToken, authUser?.role, selectedReservation]);

  useEffect(() => {
    void load();
  }, [load]);

  const openDetails = useCallback(
    async (reservation: Reservation) => {
      if (!accessToken) return;
      setSelectedReservation(reservation);
      setDetailsLoading(true);
      setLocationProposals([]);
      setCheckinInfo(null);
      setCounterpartyCode('');
      setCallSnapshot(null);
      setTimeline([]);
      try {
        const timelinePromise = reservationsApiClient.listReservationTimeline(accessToken, reservation.id);
        if (reservation.mode === 'offline') {
          const [proposals, events] = await Promise.all([
            reservationsApiClient.listLocationProposals(accessToken, reservation.id),
            timelinePromise,
          ]);
          setLocationProposals(proposals);
          setTimeline(events);
        } else {
          const [snapshot, events] = await Promise.all([
            reservationsApiClient.callSnapshot(accessToken, reservation.id).catch(() => null),
            timelinePromise,
          ]);
          if (snapshot) setCallSnapshot(snapshot);
          setTimeline(events);
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to load reservation details');
      } finally {
        setDetailsLoading(false);
      }
    },
    [accessToken],
  );

  const closeDetails = () => {
    setSelectedReservation(null);
    setLocationText('');
    setCounterpartyCode('');
    setCheckinInfo(null);
    setCallSnapshot(null);
    setTimeline([]);
  };

  const refreshSelected = useCallback(async () => {
    if (!accessToken || !selectedReservation) return;
    const refreshed = await reservationsApiClient.getReservationById(accessToken, selectedReservation.id);
    setSelectedReservation(refreshed);
    setReservations((prev) => {
      const existing = prev.some((item) => item.id === refreshed.id);
      if (!existing) return [refreshed, ...prev];
      return prev.map((item) => (item.id === refreshed.id ? refreshed : item));
    });
    if (refreshed.mode === 'offline') {
      const [proposals, events] = await Promise.all([
        reservationsApiClient.listLocationProposals(accessToken, refreshed.id),
        reservationsApiClient.listReservationTimeline(accessToken, refreshed.id),
      ]);
      setLocationProposals(proposals);
      setTimeline(events);
    } else {
      const [snapshot, events] = await Promise.all([
        reservationsApiClient.callSnapshot(accessToken, refreshed.id).catch(() => null),
        reservationsApiClient.listReservationTimeline(accessToken, refreshed.id),
      ]);
      setCallSnapshot(snapshot);
      setTimeline(events);
    }
  }, [accessToken, selectedReservation]);

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
        if (selectedReservation?.id === id) await refreshSelected();
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Action failed');
      } finally {
        setUpdatingId(null);
      }
    },
    [accessToken, load, refreshSelected, selectedReservation?.id],
  );

  const cancelReservation = useCallback(async () => {
    if (!accessToken || !selectedReservation || !authUser) return;
    setShowCancelModal(false);

    const reasonCode =
      selectedReservation.customerId === authUser.id
        ? isInterviewReservation(selectedReservation)
          ? 'customer_schedule_conflict'
          : 'customer_changed_mind'
        : 'provider_unavailable';

    setUpdatingId(selectedReservation.id);
    setError(null);
    try {
      await reservationsApiClient.cancelReservation(accessToken, selectedReservation.id, {
        reasonCode,
      });
      await load();
      await refreshSelected();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Cancellation failed');
    } finally {
      setUpdatingId(null);
    }
  }, [accessToken, authUser, load, refreshSelected, selectedReservation]);

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
        if (selectedReservation?.id === id) await refreshSelected();
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Action failed');
      } finally {
        setUpdatingId(null);
      }
    },
    [accessToken, load, refreshSelected, selectedReservation?.id],
  );

  const proposeLocation = useCallback(async () => {
    if (!accessToken || !selectedReservation || selectedReservation.mode !== 'offline') return;
    if (!locationText.trim()) return;
    setUpdatingId(selectedReservation.id);
    setError(null);
    try {
      await reservationsApiClient.proposeLocation(accessToken, selectedReservation.id, {
        locationText: locationText.trim(),
      });
      setLocationText('');
      await refreshSelected();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not propose location');
    } finally {
      setUpdatingId(null);
    }
  }, [accessToken, locationText, refreshSelected, selectedReservation]);

  const respondLocation = useCallback(
    async (proposalId: string, decision: 'accept' | 'reject') => {
      if (!accessToken || !selectedReservation || selectedReservation.mode !== 'offline') return;
      setUpdatingId(selectedReservation.id);
      setError(null);
      try {
        await reservationsApiClient.respondLocation(accessToken, selectedReservation.id, {
          proposalId,
          decision,
        });
        await refreshSelected();
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Could not respond to location proposal');
      } finally {
        setUpdatingId(null);
      }
    },
    [accessToken, refreshSelected, selectedReservation],
  );

  const getCheckinCode = useCallback(async () => {
    if (!accessToken || !selectedReservation || selectedReservation.mode !== 'offline') return;
    setUpdatingId(selectedReservation.id);
    setError(null);
    try {
      const data = await reservationsApiClient.getOfflineCheckinCodes(accessToken, selectedReservation.id);
      setCheckinInfo(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load check-in code');
    } finally {
      setUpdatingId(null);
    }
  }, [accessToken, selectedReservation]);

  const confirmCheckin = useCallback(async () => {
    if (!accessToken || !selectedReservation || selectedReservation.mode !== 'offline') return;
    if (!counterpartyCode.trim()) return;
    setUpdatingId(selectedReservation.id);
    setError(null);
    try {
      const result = await reservationsApiClient.confirmOfflineCheckin(accessToken, selectedReservation.id, {
        counterpartyCode: counterpartyCode.trim(),
      });
      setCounterpartyCode('');
      setCheckinInfo((prev) =>
        prev == null
          ? null
          : {
              ...prev,
              myVerifiedAt: result.myVerifiedAt,
              counterpartyVerifiedAt: result.counterpartyVerifiedAt,
            },
      );
      await refreshSelected();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not confirm check-in');
    } finally {
      setUpdatingId(null);
    }
  }, [accessToken, counterpartyCode, refreshSelected, selectedReservation]);

  const filteredReservations = useMemo(() => {
    if (filterStatus === 'all') return reservations;
    return reservations.filter((item) => item.status === filterStatus);
  }, [filterStatus, reservations]);

  const submitReview = useCallback(
    async (reservationId: string) => {
      if (!accessToken || reviewSubmitting) return;
      setReviewSubmitting(true);
      setError(null);
      try {
      await reviewsApiClient.create(accessToken, {
        reservationId,
        rating: reviewRating,
        ...(reviewComment.trim() ? { comment: reviewComment.trim() } : {}),
      });
        setReviewedReservationIds((prev) => new Set(prev).add(reservationId));
        setReviewingReservationId(null);
        setReviewComment('');
        setReviewRating(5);
      } catch (e) {
        const msg = e instanceof Error ? e.message : 'Failed to submit review';
        if (msg.includes('already reviewed') || msg.includes('ALREADY_REVIEWED')) {
          setReviewedReservationIds((prev) => new Set(prev).add(reservationId));
          setReviewingReservationId(null);
        } else {
          setError(msg);
        }
      } finally {
        setReviewSubmitting(false);
      }
    },
    [accessToken, reviewComment, reviewRating, reviewSubmitting],
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
      {showCancelModal && selectedReservation && authUser && (
        <div
          className="bookings-cancel-modal-overlay"
          role="dialog"
          aria-modal="true"
          aria-labelledby="cancel-modal-title"
        >
          <div className="bookings-cancel-modal">
            <h2 id="cancel-modal-title" className="bookings-cancel-modal-title">
              Cancel reservation?
            </h2>
            <p className="bookings-cancel-modal-preview">
              {getCancellationPreview(selectedReservation, authUser.id) ??
                'This will cancel the reservation. Continue?'}
            </p>
            <div className="bookings-cancel-modal-actions">
              <button
                type="button"
                className="dashboard-btn dashboard-btn--secondary"
                onClick={() => setShowCancelModal(false)}
              >
                Back
              </button>
              <button
                type="button"
                className="dashboard-btn dashboard-btn--danger"
                onClick={() => void cancelReservation()}
                disabled={updatingId === selectedReservation.id}
              >
                {updatingId === selectedReservation.id ? 'Cancelling...' : 'Confirm cancellation'}
              </button>
            </div>
          </div>
        </div>
      )}
      <Container className="profile-screen-container">
        <div className="app-page-header">
          <h1 className="app-page-title">{title}</h1>
        </div>
        {error && <p className="dashboard-error">{error}</p>}

        <div className="reservation-filter-row">
          <button
            type="button"
            className={`dashboard-btn dashboard-btn--small ${filterStatus === 'all' ? 'dashboard-btn--primary' : 'dashboard-btn--secondary'}`}
            onClick={() => setFilterStatus('all')}
          >
            All
          </button>
          {['pending', 'accepted', 'in_session', 'waiting_customer_done', 'completed', 'rejected', 'disputed'].map((status) => (
            <button
              key={status}
              type="button"
              className={`dashboard-btn dashboard-btn--small ${filterStatus === status ? 'dashboard-btn--primary' : 'dashboard-btn--secondary'}`}
              onClick={() => setFilterStatus(status)}
            >
              {statusLabels[status] ?? status}
            </button>
          ))}
        </div>

        {loading ? (
          <p className="dashboard-loading">{dictionary.admin?.loading ?? 'Loading...'}</p>
        ) : filteredReservations.length === 0 ? (
          <p className="dashboard-empty">{noBookings}</p>
        ) : (
          <ul className="calendar-booking-list">
            {filteredReservations.map((r) => (
              <li key={r.id} className="calendar-booking-item reservation-card">
                <div className="reservation-card-main">
                  <div className="calendar-booking-info">
                    <strong>{getReservationTitle(r)}</strong>
                    <span className="reservation-mode-pill">{getReservationModeLabel(r)}</span>
                    {isInterviewReservation(r) && (
                      <span className="dashboard-card-meta">
                        Hiring interview{r.jobApplicationId ? ` • Application ${r.jobApplicationId}` : ''}
                      </span>
                    )}
                    <span>{formatDateTime(r.requestedStartAt)}</span>
                    <span className={`calendar-booking-status calendar-booking-status--${r.status}`}>
                      {statusLabels[r.status] ?? r.status}
                    </span>
                  </div>

                  <div className="reservation-timeline">
                    {timelineSteps(r).map((step) => (
                      <span
                        key={`${r.id}-${step}`}
                        className={`reservation-timeline-step ${reachedStep(r.status, step) ? 'reservation-timeline-step--active' : ''}`}
                      >
                        {statusLabels[step] ?? step}
                      </span>
                    ))}
                  </div>

                  {(r.rejectionReason || r.suggestedSlots.length > 0) && (
                    <div className="reservation-note-box">
                      {r.rejectionReason && <p className="dashboard-card-meta">{r.rejectionReason}</p>}
                      {r.suggestedSlots.length > 0 && (
                        <ul className="reservation-suggestion-list">
                          {r.suggestedSlots.map((slot) => (
                            <li key={`${slot.startAt}-${slot.endAt}`}>
                              Suggested: {formatDateTime(slot.startAt)} - {new Date(slot.endAt).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  )}
                </div>

                <div className="calendar-booking-actions">
                  <button
                    type="button"
                    className="dashboard-btn dashboard-btn--small dashboard-btn--secondary"
                    onClick={() => void openDetails(r)}
                  >
                    Details
                  </button>
                  {r.status === 'completed' && !isInterviewReservation(r) && !reviewedReservationIds.has(r.id) && (
                    <>
                      {reviewingReservationId !== r.id ? (
                        <button
                          type="button"
                          className="dashboard-btn dashboard-btn--small dashboard-btn--primary"
                          onClick={() => setReviewingReservationId(r.id)}
                        >
                          Rate
                        </button>
                      ) : (
                        <div className="reservation-review-form">
                          <div className="reservation-review-stars">
                            {[1, 2, 3, 4, 5].map((star) => (
                              <button
                                key={star}
                                type="button"
                                className="reservation-review-star-btn"
                                onClick={() => setReviewRating(star)}
                                aria-label={`${star} star`}
                              >
                                {star <= reviewRating ? '★' : '☆'}
                              </button>
                            ))}
                          </div>
                          <input
                            type="text"
                            className="dashboard-input reservation-review-comment"
                            placeholder="Optional comment"
                            value={reviewComment}
                            onChange={(e) => setReviewComment(e.target.value)}
                          />
                          <div className="reservation-review-actions">
                            <button
                              type="button"
                              className="dashboard-btn dashboard-btn--small dashboard-btn--secondary"
                              onClick={() => {
                                setReviewingReservationId(null);
                                setReviewComment('');
                                setReviewRating(5);
                              }}
                            >
                              Cancel
                            </button>
                            <button
                              type="button"
                              className="dashboard-btn dashboard-btn--small dashboard-btn--primary"
                              disabled={reviewSubmitting}
                              onClick={() => void submitReview(r.id)}
                            >
                              {reviewSubmitting ? '...' : 'Submit review'}
                            </button>
                          </div>
                        </div>
                      )}
                    </>
                  )}
                  {authUser.id === r.providerId && r.status === 'pending' && (
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
                  {r.mode === 'online' && ['accepted', 'in_session', 'awaiting_start'].includes(r.status) && (
                    <button
                      type="button"
                      className="dashboard-btn dashboard-btn--small dashboard-btn--primary"
                      onClick={() => setCallReservation(r)}
                    >
                      {isInterviewReservation(r) ? 'Join Interview' : 'Join Call'}
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Container>

      {selectedReservation && (
        <div className="plan-modal-overlay" onClick={closeDetails}>
          <div className="plan-modal reservation-details-modal" onClick={(e) => e.stopPropagation()}>
            <h3 className="plan-modal-title">{getReservationTitle(selectedReservation)}</h3>
            <p className="dashboard-card-meta">
              {getReservationModeLabel(selectedReservation)} | {formatDateTime(selectedReservation.requestedStartAt)}
            </p>

            {detailsLoading ? (
              <p className="dashboard-loading">Loading details...</p>
            ) : (
              <>
                <div className="reservation-timeline reservation-timeline--detailed">
                  {timelineSteps(selectedReservation).map((step) => (
                    <span
                      key={`details-${selectedReservation.id}-${step}`}
                      className={`reservation-timeline-step ${reachedStep(selectedReservation.status, step) ? 'reservation-timeline-step--active' : ''}`}
                    >
                      {statusLabels[step] ?? step}
                    </span>
                  ))}
                </div>

                <div className="reservation-billing-box">
                  <h4>{isInterviewReservation(selectedReservation) ? 'Interview Billing' : 'Billing Summary'}</h4>
                  <p>Acceptance fee: {formatMoney(selectedReservation.adminAcceptanceFee)}</p>
                  <p>
                    {isInterviewReservation(selectedReservation) ? 'Fixed interview price' : 'Fixed reservation price'}:{' '}
                    {formatMoney(selectedReservation.expertPriceAmount)}
                  </p>
                  {selectedReservation.mode === 'online' && !isInterviewReservation(selectedReservation) && (
                    <p>Minute fee (global): {formatMoney(selectedReservation.adminMinuteRate)} / min (split 50/50)</p>
                  )}
                  {selectedReservation.mode === 'online' && isInterviewReservation(selectedReservation) && (
                    <p>Interview calls use a fixed price only. No per-minute billing applies.</p>
                  )}
                  {selectedReservation.fixedPriceHoldId && (
                    <p>Fixed price hold: Active</p>
                  )}
                  <p>Settlement: {describeSettlement(selectedReservation)}</p>
                  {(selectedReservation.refundAmount > 0 || selectedReservation.capturedAmount > 0 || selectedReservation.penaltyAmount > 0) && (
                    <>
                      <p>Refunded: {formatMoney(selectedReservation.refundAmount)}</p>
                      <p>Captured: {formatMoney(selectedReservation.capturedAmount)}</p>
                      <p>Penalty: {formatMoney(selectedReservation.penaltyAmount)}</p>
                    </>
                  )}
                  {selectedReservation.cancellationEffectiveOutcome && (
                    <p>
                      Cancellation outcome:{' '}
                      {cancellationOutcomeLabel(selectedReservation.cancellationEffectiveOutcome)}
                    </p>
                  )}
                </div>

                <div className="reservation-section-box">
                  <h4>Cancellation Policy</h4>
                  {selectedReservation.policySnapshot ? (
                    <>
                      <p>Customer free cancellation window: {selectedReservation.policySnapshot.customerFreeCancelHours} hours.</p>
                      <p>Provider penalty window: {selectedReservation.policySnapshot.providerPenaltyCancelHours} hours.</p>
                      <p>Late provider penalty: {formatMoney(selectedReservation.policySnapshot.providerLateCancelPenaltyAmount)}</p>
                    </>
                  ) : (
                    <p className="dashboard-card-meta">Policy snapshot unavailable for this reservation.</p>
                  )}
                  {authUser && getCancellationPreview(selectedReservation, authUser.id) && (
                    <p>{getCancellationPreview(selectedReservation, authUser.id)}</p>
                  )}
                </div>

                <div className="reservation-section-box">
                  <h4>Timeline</h4>
                  {timeline.length === 0 ? (
                    <p className="dashboard-card-meta">No timeline events yet.</p>
                  ) : (
                    <ul className="reservation-proposal-list">
                      {timeline.map((event) => (
                        <li key={event.id} className="reservation-proposal-item">
                          <div>
                            <strong>{event.eventType.replaceAll('_', ' ')}</strong>
                            <p className="dashboard-card-meta">{formatDateTime(event.createdAt)}</p>
                            {event.metadata && Object.keys(event.metadata).length > 0 && (
                              <p className="dashboard-card-meta">{formatTimelineMetadata(event.metadata)}</p>
                            )}
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>

                {selectedReservation.mode === 'online' && (
                  <div className="reservation-section-box">
                    <h4>{isInterviewReservation(selectedReservation) ? (bp.onlineInterview ?? 'Online Interview') : (bp.onlineSession ?? 'Online Session')}</h4>
                    {callSnapshot ? (
                      <>
                        <p>{bp.preJoinBuffer ?? 'Pre-join buffer'}: {callSnapshot.minimumPrejoinMinutes} {bp.durationMin ?? 'min'}</p>
                        <p>{bp.yourRemainingTime ?? 'Your remaining time'}: {callSnapshot.customerRemainingMinutes} {bp.durationMin ?? 'min'}</p>
                        <p>{bp.providerRemainingTime ?? 'Provider remaining time'}: {callSnapshot.providerRemainingMinutes} {bp.durationMin ?? 'min'}</p>
                        {callSnapshot.session && (
                          <p>
                            Session: {callSnapshot.session.status === 'active' ? (bp.inProgress ?? 'In progress') : callSnapshot.session.status === 'ended' ? (bp.ended ?? 'Ended') : callSnapshot.session.status} — Duration: {callSnapshot.session.billedMinutes ?? Math.round((callSnapshot.session.billedSeconds ?? 0) / 60)} {bp.durationMin ?? 'min'}
                          </p>
                        )}
                      </>
                    ) : (
                      <p className="dashboard-card-meta">{bp.callDetailsWhenStart ?? 'Call details will appear when the session starts.'}</p>
                    )}
                    {['accepted', 'in_session', 'awaiting_start'].includes(selectedReservation.status) && (
                      <button
                        type="button"
                        className="dashboard-btn dashboard-btn--small dashboard-btn--primary"
                        onClick={() => setCallReservation(selectedReservation)}
                      >
                        {isInterviewReservation(selectedReservation) ? (bp.joinInterview ?? 'Join Interview') : (bp.joinCall ?? 'Join Call')}
                      </button>
                    )}
                  </div>
                )}

                {selectedReservation.mode === 'offline' && (
                  <div className="reservation-section-box">
                    <h4>{isInterviewReservation(selectedReservation) ? 'Offline Interview' : 'Offline Meeting'}</h4>
                    {selectedReservation.finalLocationText && (
                      <p>Agreed location: {selectedReservation.finalLocationText}</p>
                    )}
                    <div className="reservation-inline-form">
                      <input
                        type="text"
                        className="dashboard-input"
                        placeholder="Propose meeting location..."
                        value={locationText}
                        onChange={(e) => setLocationText(e.target.value)}
                      />
                      <button
                        type="button"
                        className="dashboard-btn dashboard-btn--small dashboard-btn--secondary"
                        onClick={() => void proposeLocation()}
                        disabled={updatingId === selectedReservation.id || !locationText.trim()}
                      >
                        Propose
                      </button>
                    </div>

                    {locationProposals.length === 0 ? (
                      <p className="dashboard-card-meta">No location proposals yet.</p>
                    ) : (
                      <ul className="reservation-proposal-list">
                        {locationProposals.map((proposal) => {
                          const mine = proposal.proposedBy === authUser.id;
                          return (
                            <li key={proposal.id} className="reservation-proposal-item">
                              <div>
                                <strong>{proposal.locationText}</strong>
                                <p className="dashboard-card-meta">
                                  {mine ? 'You proposed' : 'Counterparty proposed'} | {proposal.status}
                                </p>
                              </div>
                              {!mine && proposal.status === 'pending' && (
                                <div className="calendar-booking-actions">
                                  <button
                                    type="button"
                                    className="dashboard-btn dashboard-btn--small dashboard-btn--primary"
                                    onClick={() => void respondLocation(proposal.id, 'accept')}
                                    disabled={updatingId === selectedReservation.id}
                                  >
                                    Accept
                                  </button>
                                  <button
                                    type="button"
                                    className="dashboard-btn dashboard-btn--small dashboard-btn--danger"
                                    onClick={() => void respondLocation(proposal.id, 'reject')}
                                    disabled={updatingId === selectedReservation.id}
                                  >
                                    Reject
                                  </button>
                                </div>
                              )}
                            </li>
                          );
                        })}
                      </ul>
                    )}

                    <div className="reservation-checkin-box">
                      <button
                        type="button"
                        className="dashboard-btn dashboard-btn--small dashboard-btn--secondary"
                        onClick={() => void getCheckinCode()}
                        disabled={updatingId === selectedReservation.id}
                      >
                        Get My Check-in Code
                      </button>
                      {checkinInfo && (
                        <div className="reservation-note-box">
                          <p>Your code: <strong>{checkinInfo.myCode}</strong></p>
                          <p>Code expires: {formatDateTime(checkinInfo.expiresAt)}</p>
                          <p>My check-in: {checkinInfo.myVerifiedAt ? 'Verified' : 'Pending'}</p>
                          <p>Counterparty check-in: {checkinInfo.counterpartyVerifiedAt ? 'Verified' : 'Pending'}</p>
                        </div>
                      )}
                      <div className="reservation-inline-form">
                        <input
                          type="text"
                          className="dashboard-input"
                          placeholder="Enter counterparty code"
                          value={counterpartyCode}
                          onChange={(e) => setCounterpartyCode(e.target.value)}
                        />
                        <button
                          type="button"
                          className="dashboard-btn dashboard-btn--small dashboard-btn--primary"
                          onClick={() => void confirmCheckin()}
                          disabled={updatingId === selectedReservation.id || !counterpartyCode.trim()}
                        >
                          Confirm Check-in
                        </button>
                      </div>
                    </div>
                  </div>
                )}

                {authUser.id === selectedReservation.providerId && selectedReservation.status === 'pending' && (
                  <div className="calendar-booking-actions calendar-booking-actions--spaced">
                    <button
                      type="button"
                      className="dashboard-btn dashboard-btn--small dashboard-btn--primary"
                      onClick={() => void decide(selectedReservation.id, 'accept')}
                      disabled={updatingId === selectedReservation.id}
                    >
                      {bp.accept ?? 'Accept'}
                    </button>
                    <button
                      type="button"
                      className="dashboard-btn dashboard-btn--small dashboard-btn--danger"
                      onClick={() => void decide(selectedReservation.id, 'reject')}
                      disabled={updatingId === selectedReservation.id}
                    >
                      {bp.reject ?? 'Reject'}
                    </button>
                  </div>
                )}

                {authUser &&
                  canCancelReservation(selectedReservation) &&
                  (authUser.id === selectedReservation.customerId ||
                    authUser.id === selectedReservation.providerId) && (
                  <div className="calendar-booking-actions calendar-booking-actions--spaced">
                    <button
                      type="button"
                      className="dashboard-btn dashboard-btn--small dashboard-btn--danger"
                      onClick={() => setShowCancelModal(true)}
                      disabled={updatingId === selectedReservation.id}
                    >
                      {bp.cancelReservation ?? 'Cancel Reservation'}
                    </button>
                  </div>
                )}

                {authUser.id === selectedReservation.customerId && selectedReservation.status === 'waiting_customer_done' && (
                  <div className="calendar-booking-actions calendar-booking-actions--spaced">
                    <button
                      type="button"
                      className="dashboard-btn dashboard-btn--small dashboard-btn--primary"
                      onClick={() => void finish(selectedReservation.id, 'done')}
                      disabled={updatingId === selectedReservation.id}
                    >
                      {bp.done ?? 'Done'}
                    </button>
                    <button
                      type="button"
                      className="dashboard-btn dashboard-btn--small dashboard-btn--danger"
                      onClick={() => void finish(selectedReservation.id, 'report')}
                      disabled={updatingId === selectedReservation.id}
                    >
                      {bp.report ?? 'Report'}
                    </button>
                  </div>
                )}
                {selectedReservation.status === 'completed' &&
                  !isInterviewReservation(selectedReservation) &&
                  !reviewedReservationIds.has(selectedReservation.id) && (
                  <div className="reservation-details-review-box reservation-details-review-box--spaced">
                    <h4>{bp.leaveReview ?? 'Leave a review'}</h4>
                    {reviewingReservationId !== selectedReservation.id ? (
                      <button
                        type="button"
                        className="dashboard-btn dashboard-btn--small dashboard-btn--primary"
                        onClick={() => setReviewingReservationId(selectedReservation.id)}
                      >
                        {authUser.id === selectedReservation.customerId ? (bp.rateProvider ?? 'Rate this provider') : (bp.rateCustomer ?? 'Rate this customer')}
                      </button>
                    ) : (
                      <>
                        <div className="reservation-review-stars">
                          {[1, 2, 3, 4, 5].map((star) => (
                            <button
                              key={star}
                              type="button"
                              className="reservation-review-star-btn"
                              onClick={() => setReviewRating(star)}
                              aria-label={`${star} star`}
                            >
                              {star <= reviewRating ? '★' : '☆'}
                            </button>
                          ))}
                        </div>
                        <input
                          type="text"
                          className="dashboard-input reservation-review-comment reservation-review-comment--spaced"
                          placeholder={dictionary.profile?.reviews?.commentPlaceholder ?? 'Optional comment'}
                          value={reviewComment}
                          onChange={(e) => setReviewComment(e.target.value)}
                        />
                        <div className="reservation-review-actions reservation-review-actions--spaced">
                          <button
                            type="button"
                            className="dashboard-btn dashboard-btn--small dashboard-btn--secondary"
                            onClick={() => {
                              setReviewingReservationId(null);
                              setReviewComment('');
                              setReviewRating(5);
                            }}
                          >
                            Cancel
                          </button>
                          <button
                            type="button"
                            className="dashboard-btn dashboard-btn--small dashboard-btn--primary"
                            disabled={reviewSubmitting}
                            onClick={() => void submitReview(selectedReservation.id)}
                          >
                            {reviewSubmitting ? '...' : 'Submit review'}
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                )}
              </>
            )}

            <div className="plan-modal-actions plan-modal-actions--spaced">
              <button
                type="button"
                className="plan-modal-cancel"
                onClick={(e) => {
                  e.stopPropagation();
                  e.preventDefault();
                  setTimeout(closeDetails, 0);
                }}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      <OnlineCallModal
        open={callReservation != null}
        reservation={callReservation}
        accessToken={accessToken ?? ''}
        onClose={() => {
          setCallReservation(null);
          if (selectedReservation) {
            void refreshSelected();
          }
        }}
        onEnded={() => {
          void load();
          if (selectedReservation) {
            void refreshSelected();
          }
        }}
      />
    </main>
  );
};
