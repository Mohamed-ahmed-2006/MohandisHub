'use client';

import type {
  Reservation,
  ReservationCallSnapshot,
  ReservationLocationProposal,
} from '@mohandishub/shared';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { OnlineCallModal } from './online-call-modal';

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
  return `${value.toFixed(2)} EGP`;
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

export const BookingsScreen = ({ locale, dictionary }: Props) => {
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
  const [filterStatus, setFilterStatus] = useState<string>('all');

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
        limit: 80,
      });
      setReservations(res.items);
      if (selectedReservation) {
        const refreshed = res.items.find((item) => item.id === selectedReservation.id) ?? null;
        setSelectedReservation(refreshed);
      }
    } catch (e) {
      setReservations([]);
      setError(e instanceof Error ? e.message : 'Failed to load reservations');
    } finally {
      setLoading(false);
    }
  }, [accessToken, role, selectedReservation]);

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
      try {
        if (reservation.mode === 'offline') {
          const proposals = await reservationsApiClient.listLocationProposals(accessToken, reservation.id);
          setLocationProposals(proposals);
        } else {
          const snapshot = await reservationsApiClient.callSnapshot(accessToken, reservation.id).catch(() => null);
          if (snapshot) setCallSnapshot(snapshot);
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
  };

  const refreshSelected = useCallback(async () => {
    if (!accessToken || !selectedReservation) return;
    const refreshed = await reservationsApiClient.getReservationById(accessToken, selectedReservation.id);
    setSelectedReservation(refreshed);
    setReservations((prev) => prev.map((item) => (item.id === refreshed.id ? refreshed : item)));
    if (refreshed.mode === 'offline') {
      const proposals = await reservationsApiClient.listLocationProposals(accessToken, refreshed.id);
      setLocationProposals(proposals);
    } else {
      const snapshot = await reservationsApiClient.callSnapshot(accessToken, refreshed.id).catch(() => null);
      setCallSnapshot(snapshot);
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
                    <strong>{r.serviceTitle ?? 'Reservation'}</strong>
                    <span className="reservation-mode-pill">
                      {r.mode === 'online' ? `Online ${r.onlineType ?? 'voice'}` : 'Offline'}
                    </span>
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
                  {r.mode === 'online' && ['accepted', 'in_session', 'awaiting_start'].includes(r.status) && (
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

      {selectedReservation && (
        <div className="plan-modal-overlay" onClick={closeDetails}>
          <div className="plan-modal reservation-details-modal" onClick={(e) => e.stopPropagation()}>
            <h3 className="plan-modal-title">{selectedReservation.serviceTitle ?? 'Reservation Details'}</h3>
            <p className="dashboard-card-meta">
              {selectedReservation.mode === 'online' ? `Online (${selectedReservation.onlineType ?? 'voice'})` : 'Offline'} | {formatDateTime(selectedReservation.requestedStartAt)}
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
                  <h4>Billing Summary</h4>
                  <p>Acceptance fee: {formatMoney(selectedReservation.adminAcceptanceFee)}</p>
                  <p>Fixed reservation price: {formatMoney(selectedReservation.expertPriceAmount)}</p>
                  {selectedReservation.mode === 'online' && (
                    <p>Minute fee (global): {formatMoney(selectedReservation.adminMinuteRate)} / min (split 50/50)</p>
                  )}
                  {selectedReservation.fixedPriceHoldId && (
                    <p>Fixed price hold: Active</p>
                  )}
                </div>

                {selectedReservation.mode === 'online' && (
                  <div className="reservation-section-box">
                    <h4>Online Session</h4>
                    {callSnapshot ? (
                      <>
                        <p>Minimum prejoin minutes: {callSnapshot.minimumPrejoinMinutes}</p>
                        <p>Customer remaining minutes: {callSnapshot.customerRemainingMinutes}</p>
                        <p>Provider remaining minutes: {callSnapshot.providerRemainingMinutes}</p>
                        {callSnapshot.session && (
                          <p>
                            Call status: {callSnapshot.session.status} | billed seconds: {callSnapshot.session.billedSeconds} (minutes: {callSnapshot.session.billedMinutes})
                          </p>
                        )}
                      </>
                    ) : (
                      <p className="dashboard-card-meta">Call snapshot unavailable until call session starts.</p>
                    )}
                    {['accepted', 'in_session', 'awaiting_start'].includes(selectedReservation.status) && (
                      <button
                        type="button"
                        className="dashboard-btn dashboard-btn--small dashboard-btn--primary"
                        onClick={() => setCallReservation(selectedReservation)}
                      >
                        Join Call
                      </button>
                    )}
                  </div>
                )}

                {selectedReservation.mode === 'offline' && (
                  <div className="reservation-section-box">
                    <h4>Offline Meeting</h4>
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

                {role === 'provider' && selectedReservation.status === 'pending' && (
                  <div className="calendar-booking-actions" style={{ marginTop: '1rem' }}>
                    <button
                      type="button"
                      className="dashboard-btn dashboard-btn--small dashboard-btn--primary"
                      onClick={() => void decide(selectedReservation.id, 'accept')}
                      disabled={updatingId === selectedReservation.id}
                    >
                      Accept
                    </button>
                    <button
                      type="button"
                      className="dashboard-btn dashboard-btn--small dashboard-btn--danger"
                      onClick={() => void decide(selectedReservation.id, 'reject')}
                      disabled={updatingId === selectedReservation.id}
                    >
                      Reject
                    </button>
                  </div>
                )}

                {role === 'customer' && selectedReservation.status === 'waiting_customer_done' && (
                  <div className="calendar-booking-actions" style={{ marginTop: '1rem' }}>
                    <button
                      type="button"
                      className="dashboard-btn dashboard-btn--small dashboard-btn--primary"
                      onClick={() => void finish(selectedReservation.id, 'done')}
                      disabled={updatingId === selectedReservation.id}
                    >
                      Done
                    </button>
                    <button
                      type="button"
                      className="dashboard-btn dashboard-btn--small dashboard-btn--danger"
                      onClick={() => void finish(selectedReservation.id, 'report')}
                      disabled={updatingId === selectedReservation.id}
                    >
                      Report
                    </button>
                  </div>
                )}
              </>
            )}

            <div className="plan-modal-actions" style={{ marginTop: '1.25rem' }}>
              <button type="button" className="plan-modal-cancel" onClick={closeDetails}>
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

