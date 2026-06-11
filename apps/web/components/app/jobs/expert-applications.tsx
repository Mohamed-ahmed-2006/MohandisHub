'use client';

import type {
  JobApplication,
  JobMilestone,
  Reservation,
  ReservationSlot,
} from '@mohandishub/shared';
import { useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';

import { OnlineCallModal } from '../online-call-modal';

import { ApplicationChat } from './application-chat';

import { useToast } from '@/components/app/toast';
import { jobsApiClient } from '@/lib/jobs/client';
import { reservationsApiClient } from '@/lib/reservations/client';
import { getPrivateFileOpenableUrl } from '@/lib/upload/client';

function formatMoney(value: number): string {
  return `${value.toFixed(2)} EGP`;
}

function formatDateTime(value: string): string {
  return new Date(value).toLocaleString();
}

export const ExpertApplications = ({ accessToken }: { accessToken: string }) => {
  const { addToast } = useToast();
  const searchParams = useSearchParams();
  const [applications, setApplications] = useState<JobApplication[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedAppId, setSelectedAppId] = useState<string | null>(null);
  const [milestones, setMilestones] = useState<JobMilestone[]>([]);
  const [interviewSlots, setInterviewSlots] = useState<ReservationSlot[]>([]);
  const [callReservation, setCallReservation] = useState<Reservation | null>(null);

  const selectedApp = applications.find((app) => app.id === selectedAppId) ?? null;

  const loadApplications = useCallback(async () => {
    try {
      const res = await jobsApiClient.listExpertApplications(accessToken);
      setApplications(res);
    } finally {
      setLoading(false);
    }
  }, [accessToken]);

  useEffect(() => {
    void loadApplications();
  }, [loadApplications]);

  const openApplication = useCallback(
    async (app: JobApplication) => {
      if (selectedAppId === app.id) {
        setSelectedAppId(null);
        setMilestones([]);
        setInterviewSlots([]);
        return;
      }

      setSelectedAppId(app.id);
      if (app.status === 'accepted') {
        const milestoneRows = await jobsApiClient.getMilestones(accessToken, app.id);
        setMilestones(milestoneRows);
        if (app.interviewReservationId) {
          const slotRows = await jobsApiClient.listApplicationInterviewSlots(accessToken, app.id);
          setInterviewSlots(slotRows.items);
        } else {
          setInterviewSlots([]);
        }
        return;
      }

      if (['interview_invited', 'interview_booked', 'interview_completed'].includes(app.status)) {
        const slotRows = await jobsApiClient.listApplicationInterviewSlots(accessToken, app.id);
        setInterviewSlots(slotRows.items);
      } else {
        setInterviewSlots([]);
      }
      setMilestones([]);
    },
    [accessToken, selectedAppId],
  );

  useEffect(() => {
    const applicationId = searchParams.get('application');
    if (!applicationId || loading || selectedAppId === applicationId) return;
    const app = applications.find((item) => item.id === applicationId);
    if (!app) return;
    void openApplication(app);
  }, [applications, loading, openApplication, searchParams, selectedAppId]);

  const handleSubmitMilestone = async (milestoneId: string, notes: string) => {
    try {
      await jobsApiClient.submitMilestone(accessToken, milestoneId, { submissionNotes: notes });
      addToast('Success', 'Milestone submitted');
      if (selectedAppId) {
        const milestoneRows = await jobsApiClient.getMilestones(accessToken, selectedAppId);
        setMilestones(milestoneRows);
      }
    } catch (err: unknown) {
      addToast('Error', err instanceof Error ? err.message : 'Failed to submit milestone');
    }
  };

  const handleBookInterview = async (slotId: string, mode: 'online' | 'offline') => {
    if (!selectedApp) return;
    try {
      await jobsApiClient.bookInterview(accessToken, selectedApp.id, { slotId, mode });
      await loadApplications();
      const refreshed = await jobsApiClient.listApplicationInterviewSlots(
        accessToken,
        selectedApp.id,
      );
      setInterviewSlots(refreshed.items);
    } catch (err) {
      addToast('Error', err instanceof Error ? err.message : 'Failed to book interview');
    }
  };

  const openInterviewReservation = async (reservationId: string) => {
    try {
      const reservation = await reservationsApiClient.getReservationById(
        accessToken,
        reservationId,
      );
      if (reservation.mode !== 'online') {
        addToast('Notice', 'This interview reservation is offline.');
        return;
      }
      setCallReservation(reservation);
    } catch (err) {
      addToast('Error', err instanceof Error ? err.message : 'Failed to open interview');
    }
  };

  if (loading) return <p>Loading my applications...</p>;

  return (
    <div className="dashboard-section" style={{ marginTop: '2rem' }}>
      <h3 className="dashboard-section-title">My Applications</h3>
      {applications.length === 0 ? (
        <p className="dashboard-empty">No applications yet.</p>
      ) : (
        <ul style={{ listStyle: 'none', padding: 0, display: 'grid', gap: '1rem' }}>
          {applications.map((app) => (
            <li
              key={app.id}
              style={{
                padding: '1rem',
                background: '#f9f9f9',
                borderRadius: '12px',
                border: '1px solid #eee',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem' }}>
                <div>
                  <strong>{app.jobTitle || app.jobId}</strong>
                  <p className="dashboard-card-meta" style={{ marginTop: '0.35rem' }}>
                    {app.businessName || 'Business'} | {app.status.replaceAll('_', ' ')}
                  </p>
                  <p className="dashboard-card-meta">
                    Submitted via {app.submissionType === 'cv_upload' ? 'CV upload' : 'app profile'}{' '}
                    | Paid {formatMoney(app.applicationFeeAmount)}
                  </p>
                  {app.coverLetter && <p style={{ marginTop: '0.75rem' }}>{app.coverLetter}</p>}
                  {app.cvFileUrl ? (
                    <p style={{ marginTop: '0.5rem' }}>
                      <button
                        type="button"
                        className="dashboard-link-btn"
                        onClick={() => {
                          void getPrivateFileOpenableUrl(accessToken, app.cvFileUrl!)
                            .then((url) => window.open(url, '_blank', 'noopener,noreferrer'))
                            .catch(() => {});
                        }}
                      >
                        Open submitted CV
                      </button>
                    </p>
                  ) : (
                    <p className="dashboard-card-meta" style={{ marginTop: '0.5rem' }}>
                      Profile snapshot was attached to this application.
                    </p>
                  )}
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                  <button className="dashboard-link-btn" onClick={() => void openApplication(app)}>
                    {selectedAppId === app.id ? 'Hide Details' : 'Open Details'}
                  </button>
                  {app.interviewReservationId &&
                    ['interview_booked', 'interview_completed', 'accepted'].includes(
                      app.status,
                    ) && (
                      <button
                        className="dashboard-btn dashboard-btn--small dashboard-btn--secondary"
                        onClick={() => void openInterviewReservation(app.interviewReservationId!)}
                      >
                        {app.status === 'interview_booked' ? 'Join Interview' : 'Open Interview'}
                      </button>
                    )}
                </div>
              </div>

              {selectedAppId === app.id && (
                <div style={{ marginTop: '1rem', display: 'grid', gap: '1rem' }}>
                  <div
                    style={{
                      padding: '1rem',
                      background: '#fff',
                      border: '1px solid #ddd',
                      borderRadius: '10px',
                    }}
                  >
                    <h4 style={{ marginBottom: '0.75rem' }}>Submission Receipt</h4>
                    <p className="dashboard-card-meta">
                      Application fee: {formatMoney(app.applicationFeeAmount)}
                    </p>
                    <p className="dashboard-card-meta">
                      Submission type:{' '}
                      {app.submissionType === 'cv_upload' ? 'CV upload' : 'Profile snapshot'}
                    </p>
                    {app.interviewInvitationSentAt && (
                      <p className="dashboard-card-meta">
                        Interview invited at {formatDateTime(app.interviewInvitationSentAt)}
                      </p>
                    )}
                    {Boolean(app.profileSnapshot) && (
                      <p className="dashboard-card-meta" style={{ marginTop: '0.5rem' }}>
                        Your expert profile snapshot was stored with this application.
                      </p>
                    )}
                    {app.interviewReservationId && (
                      <p className="dashboard-card-meta" style={{ marginTop: '0.5rem' }}>
                        Interview reservation ID: {app.interviewReservationId}
                      </p>
                    )}
                  </div>

                  {app.status === 'accepted' && (
                    <div
                      style={{
                        padding: '1rem',
                        background: '#fff',
                        border: '1px solid #ddd',
                        borderRadius: '10px',
                      }}
                    >
                      <h4 style={{ marginBottom: '1rem' }}>Project Milestones</h4>
                      {milestones.length === 0 ? (
                        <p>No milestones created yet.</p>
                      ) : (
                        <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
                          {milestones.map((milestone) => (
                            <li
                              key={milestone.id}
                              style={{
                                marginBottom: '1rem',
                                paddingBottom: '1rem',
                                borderBottom: '1px solid #eee',
                              }}
                            >
                              <div
                                style={{
                                  display: 'flex',
                                  justifyContent: 'space-between',
                                  marginBottom: '0.5rem',
                                }}
                              >
                                <strong>{milestone.title}</strong>
                                <span>
                                  {milestone.amount} EGP | {milestone.status}
                                </span>
                              </div>
                              {['pending', 'active', 'rejected'].includes(milestone.status) && (
                                <form
                                  style={{ display: 'flex', gap: '0.5rem' }}
                                  onSubmit={(e) => {
                                    e.preventDefault();
                                    const form = e.currentTarget;
                                    const notes = (
                                      form.elements.namedItem('notes') as HTMLInputElement
                                    ).value;
                                    void handleSubmitMilestone(milestone.id, notes);
                                  }}
                                >
                                  <input
                                    name="notes"
                                    className="dashboard-input"
                                    placeholder="Submission notes or link"
                                    required
                                    style={{ flex: 1 }}
                                  />
                                  <button
                                    type="submit"
                                    className="dashboard-primary-btn dashboard-primary-btn--small"
                                  >
                                    Submit
                                  </button>
                                </form>
                              )}
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  )}

                  {['interview_invited', 'interview_booked', 'interview_completed'].includes(
                    app.status,
                  ) && (
                    <div
                      style={{
                        padding: '1rem',
                        background: '#fff',
                        border: '1px solid #ddd',
                        borderRadius: '10px',
                      }}
                    >
                      <h4 style={{ marginBottom: '0.5rem' }}>Interview</h4>
                      {app.interviewInvitationSentAt && (
                        <p className="dashboard-card-meta">
                          Invited at {formatDateTime(app.interviewInvitationSentAt)}
                        </p>
                      )}
                      {app.status === 'interview_booked' && (
                        <p className="dashboard-card-meta" style={{ marginTop: '0.5rem' }}>
                          Your interview has been booked. Use the reservation link to join or review
                          details.
                        </p>
                      )}
                      {app.status === 'interview_completed' && (
                        <p className="dashboard-card-meta" style={{ marginTop: '0.5rem' }}>
                          The interview is marked completed. You can still open the reservation
                          record below.
                        </p>
                      )}
                      {app.status === 'interview_invited' && (
                        <>
                          {interviewSlots.length === 0 ? (
                            <p>No interview slots are available yet.</p>
                          ) : (
                            <ul
                              style={{
                                listStyle: 'none',
                                padding: 0,
                                margin: '1rem 0 0',
                                display: 'grid',
                                gap: '0.75rem',
                              }}
                            >
                              {interviewSlots.map((slot) => (
                                <li
                                  key={slot.id}
                                  style={{
                                    padding: '0.85rem 1rem',
                                    border: '1px solid #e5e7eb',
                                    borderRadius: '10px',
                                  }}
                                >
                                  <strong>{formatDateTime(slot.startAt)}</strong>
                                  <p className="dashboard-card-meta">
                                    Ends {formatDateTime(slot.endAt)}
                                  </p>
                                  <div
                                    style={{ display: 'flex', gap: '0.5rem', marginTop: '0.75rem' }}
                                  >
                                    {slot.supportsOnline && (
                                      <button
                                        className="dashboard-primary-btn dashboard-primary-btn--small"
                                        onClick={() => void handleBookInterview(slot.id, 'online')}
                                      >
                                        Book online
                                      </button>
                                    )}
                                    {slot.supportsOffline && (
                                      <button
                                        className="dashboard-btn dashboard-btn--secondary dashboard-btn--small"
                                        onClick={() => void handleBookInterview(slot.id, 'offline')}
                                      >
                                        Book offline
                                      </button>
                                    )}
                                  </div>
                                </li>
                              ))}
                            </ul>
                          )}
                        </>
                      )}
                      {app.interviewReservationId && app.status !== 'interview_invited' && (
                        <div
                          style={{
                            marginTop: '0.75rem',
                            display: 'flex',
                            gap: '0.5rem',
                            flexWrap: 'wrap',
                          }}
                        >
                          <p className="dashboard-card-meta" style={{ margin: 0 }}>
                            Reservation ID: {app.interviewReservationId}
                          </p>
                          <button
                            className="dashboard-btn dashboard-btn--small dashboard-btn--secondary"
                            onClick={() =>
                              void openInterviewReservation(app.interviewReservationId!)
                            }
                          >
                            Open reservation
                          </button>
                        </div>
                      )}
                    </div>
                  )}

                  <div>
                    <h4 style={{ marginBottom: '0.5rem' }}>Application Chat</h4>
                    <ApplicationChat applicationId={app.id} />
                  </div>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      <OnlineCallModal
        open={callReservation != null}
        reservation={callReservation}
        accessToken={accessToken}
        onClose={() => setCallReservation(null)}
        onEnded={() => {
          setCallReservation(null);
          void loadApplications();
        }}
      />
    </div>
  );
};
