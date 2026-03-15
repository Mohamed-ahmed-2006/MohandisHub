'use client';

import type { Job, JobApplication, Reservation, ReservationSlot } from '@mohandishub/shared';
import { useCallback, useEffect, useState } from 'react';

import { ApplicationChat } from './jobs/application-chat';
import { BusinessMilestoneManager } from './jobs/business-milestone-manager';
import { JobCard } from './jobs/job-card';
import { OnlineCallModal } from './online-call-modal';

import { useToast } from '@/components/app/toast';
import { jobsApiClient } from '@/lib/jobs/client';
import { reservationsApiClient } from '@/lib/reservations/client';
import { getPrivateFileOpenableUrl } from '@/lib/upload/client';

export const BusinessJobsTab = ({ accessToken }: { accessToken: string }) => {
  const { addToast } = useToast();
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [creating, setCreating] = useState(false);
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);
  const [applications, setApplications] = useState<JobApplication[]>([]);
  const [interviewSlots, setInterviewSlots] = useState<ReservationSlot[]>([]);
  const [callReservation, setCallReservation] = useState<Reservation | null>(null);

  const selectedJob = jobs.find((job) => job.id === selectedJobId) ?? null;

  const loadJobs = useCallback(async () => {
    try {
      const res = await jobsApiClient.listBusinessJobs(accessToken, 1, 50);
      setJobs(res.items);
    } finally {
      setLoading(false);
    }
  }, [accessToken]);

  const loadApplications = useCallback(
    async (jobId: string) => {
      const apps = await jobsApiClient.getJobApplications(accessToken, jobId);
      setApplications(apps);
    },
    [accessToken],
  );

  const loadInterviewSlots = useCallback(
    async (jobId: string) => {
      const res = await jobsApiClient.listBusinessInterviewSlots(accessToken, jobId);
      setInterviewSlots(res.items);
    },
    [accessToken],
  );

  useEffect(() => {
    void loadJobs();
  }, [loadJobs]);

  const openJob = async (jobId: string) => {
    if (selectedJobId === jobId) {
      setSelectedJobId(null);
      setApplications([]);
      setInterviewSlots([]);
      return;
    }

    setSelectedJobId(jobId);
    await loadApplications(jobId);
    const job = jobs.find((item) => item.id === jobId);
    if (job?.interviewEnabled) {
      await loadInterviewSlots(jobId);
    } else {
      setInterviewSlots([]);
    }
  };

  const handleCreate = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setCreating(true);
    const form = e.currentTarget;
    try {
      await jobsApiClient.createJob(accessToken, {
        title: (form.elements.namedItem('title') as HTMLInputElement).value,
        description: (form.elements.namedItem('description') as HTMLTextAreaElement).value,
        requirements: (form.elements.namedItem('requirements') as HTMLTextAreaElement).value,
        salaryRange: (form.elements.namedItem('salaryRange') as HTMLInputElement).value,
        applicationFeeAmount: parseFloat(
          (form.elements.namedItem('applicationFeeAmount') as HTMLInputElement).value || '0',
        ),
        interviewEnabled: (form.elements.namedItem('interviewEnabled') as HTMLInputElement).checked,
        interviewInstructions: (
          form.elements.namedItem('interviewInstructions') as HTMLTextAreaElement
        ).value,
      });
      setShowCreate(false);
      await loadJobs();
      addToast('Success', 'Hiring post created.');
    } catch (err) {
      addToast('Error', err instanceof Error ? err.message : 'Failed to create hiring post');
    } finally {
      setCreating(false);
    }
  };

  const handleUpdateApp = async (appId: string, status: JobApplication['status']) => {
    try {
      await jobsApiClient.updateApplicationStatus(accessToken, appId, status);
      if (selectedJobId) {
        await loadApplications(selectedJobId);
      }
    } catch (err) {
      addToast('Error', err instanceof Error ? err.message : 'Failed to update application');
    }
  };

  const handleCreateInterviewSlot = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!selectedJob) return;
    const form = e.currentTarget;
    try {
      await jobsApiClient.createInterviewSlot(accessToken, selectedJob.id, {
        startAt: (form.elements.namedItem('startAt') as HTMLInputElement).value,
        endAt: (form.elements.namedItem('endAt') as HTMLInputElement).value,
        supportsOnline: (form.elements.namedItem('supportsOnline') as HTMLInputElement).checked,
        supportsOffline: (form.elements.namedItem('supportsOffline') as HTMLInputElement).checked,
      });
      form.reset();
      await loadInterviewSlots(selectedJob.id);
    } catch (err) {
      addToast('Error', err instanceof Error ? err.message : 'Failed to create interview slot');
    }
  };

  const handleDeleteInterviewSlot = async (slotId: string) => {
    if (!selectedJob) return;
    try {
      await jobsApiClient.deleteInterviewSlot(accessToken, slotId);
      await loadInterviewSlots(selectedJob.id);
    } catch (err) {
      addToast('Error', err instanceof Error ? err.message : 'Failed to delete interview slot');
    }
  };

  const handleToggleInterviewSlot = async (
    slotId: string,
    status: 'available' | 'blocked',
  ) => {
    if (!selectedJob) return;
    try {
      await jobsApiClient.updateInterviewSlot(accessToken, slotId, { status });
      await loadInterviewSlots(selectedJob.id);
    } catch (err) {
      addToast('Error', err instanceof Error ? err.message : 'Failed to update interview slot');
    }
  };

  const openInterviewReservation = async (reservationId: string) => {
    try {
      const reservation = await reservationsApiClient.getReservationById(accessToken, reservationId);
      if (reservation.mode !== 'online') {
        addToast('Notice', 'This interview was booked as an offline reservation.');
        return;
      }
      setCallReservation(reservation);
    } catch (err) {
      addToast('Error', err instanceof Error ? err.message : 'Failed to open reservation');
    }
  };

  if (loading) return <p>Loading jobs...</p>;

  return (
    <div className="dashboard-section">
      <div className="dashboard-section-header">
        <h3 className="dashboard-section-title">My Hiring Posts</h3>
        <button className="dashboard-primary-btn" onClick={() => setShowCreate(true)}>
          Post a Hiring Need
        </button>
      </div>

      <div className="dashboard-cards">
        {jobs.map((job) => (
          <JobCard key={job.id} job={job}>
            <button className="dashboard-link-btn" onClick={() => void openJob(job.id)}>
              {selectedJobId === job.id ? 'Hide Details' : 'Manage Applications'}
            </button>
          </JobCard>
        ))}
      </div>

      {selectedJob && (
        <div style={{ marginTop: '1.5rem', display: 'grid', gap: '1rem' }}>
          <div className="dashboard-card">
            <h4 className="dashboard-card-title">Applications</h4>
            {applications.length === 0 ? (
              <p className="dashboard-empty">No applications yet.</p>
            ) : (
              <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: '1rem' }}>
                {applications.map((app) => (
                  <li
                    key={app.id}
                    style={{
                      padding: '1rem',
                      background: '#fff',
                      border: '1px solid #e5e7eb',
                      borderRadius: '12px',
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem' }}>
                      <div>
                        <strong>{app.expertName || app.expertId}</strong>
                        <p className="dashboard-card-meta" style={{ marginTop: '0.35rem' }}>
                          {app.status} | {app.submissionType === 'cv_upload' ? 'CV uploaded' : 'Profile snapshot'}
                        </p>
                        <p className="dashboard-card-meta">
                          Paid {app.applicationFeeAmount.toFixed(2)} USD | Business gets{' '}
                          {app.businessPayoutAmount.toFixed(2)} USD | Platform gets{' '}
                          {app.applicationCommissionAmount.toFixed(2)} USD
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
                              Open CV
                            </button>
                          </p>
                        ) : (
                          <p className="dashboard-card-meta" style={{ marginTop: '0.5rem' }}>
                            App profile snapshot attached.
                          </p>
                        )}
                        {app.interviewInvitationSentAt && (
                          <p className="dashboard-card-meta" style={{ marginTop: '0.5rem' }}>
                            Interview invited at {new Date(app.interviewInvitationSentAt).toLocaleString()}
                          </p>
                        )}
                      </div>

                      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                        {!['accepted', 'rejected'].includes(app.status) && (
                          <>
                            {selectedJob.interviewEnabled && (
                              <button
                                className="dashboard-btn dashboard-btn--small dashboard-btn--secondary"
                                onClick={() => void handleUpdateApp(app.id, 'interview_invited')}
                              >
                                Invite Interview
                              </button>
                            )}
                            <button
                              className="dashboard-primary-btn dashboard-primary-btn--small"
                              onClick={() => void handleUpdateApp(app.id, 'accepted')}
                            >
                              Accept
                            </button>
                            <button
                              className="dashboard-btn dashboard-btn--secondary dashboard-btn--small"
                              onClick={() => void handleUpdateApp(app.id, 'rejected')}
                            >
                              Reject
                            </button>
                          </>
                        )}
                        {app.interviewReservationId && app.status === 'interview_booked' && (
                          <button
                            className="dashboard-btn dashboard-btn--small dashboard-btn--secondary"
                            onClick={() => void openInterviewReservation(app.interviewReservationId!)}
                          >
                            Open Interview
                          </button>
                        )}
                      </div>
                    </div>

                    {app.status === 'accepted' && (
                      <div style={{ marginTop: '1rem', display: 'grid', gap: '1rem' }}>
                        <BusinessMilestoneManager accessToken={accessToken} applicationId={app.id} />
                        <div>
                          <h4>Project Chat</h4>
                          <ApplicationChat applicationId={app.id} />
                        </div>
                      </div>
                    )}

                    {app.status !== 'accepted' && (
                      <div style={{ marginTop: '1rem' }}>
                        <h4 style={{ marginBottom: '0.5rem' }}>Application Chat</h4>
                        <ApplicationChat applicationId={app.id} />
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>

          {selectedJob.interviewEnabled && (
            <div className="dashboard-card">
              <h4 className="dashboard-card-title">Interview Slots</h4>
              <p className="dashboard-card-meta">
                These slots are published for invited experts on this hiring post.
              </p>

              {interviewSlots.length === 0 ? (
                <p className="dashboard-empty">No interview slots yet.</p>
              ) : (
                <ul style={{ listStyle: 'none', padding: 0, margin: '1rem 0', display: 'grid', gap: '0.75rem' }}>
                  {interviewSlots.map((slot) => (
                    <li
                      key={slot.id}
                      style={{
                        padding: '0.85rem 1rem',
                        border: '1px solid #e5e7eb',
                        borderRadius: '10px',
                        display: 'flex',
                        justifyContent: 'space-between',
                        gap: '1rem',
                      }}
                    >
                      <div>
                        <strong>{new Date(slot.startAt).toLocaleString()}</strong>
                        <p className="dashboard-card-meta">
                          Ends {new Date(slot.endAt).toLocaleString()} | {slot.status} |{' '}
                          {slot.supportsOnline ? 'Online' : ''}{slot.supportsOnline && slot.supportsOffline ? ' / ' : ''}
                          {slot.supportsOffline ? 'Offline' : ''}
                        </p>
                      </div>
                      <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                        {slot.status === 'available' ? (
                          <button
                            className="dashboard-btn dashboard-btn--small dashboard-btn--secondary"
                            onClick={() => void handleToggleInterviewSlot(slot.id, 'blocked')}
                          >
                            Block
                          </button>
                        ) : slot.status === 'blocked' ? (
                          <button
                            className="dashboard-btn dashboard-btn--small dashboard-btn--secondary"
                            onClick={() => void handleToggleInterviewSlot(slot.id, 'available')}
                          >
                            Reopen
                          </button>
                        ) : null}
                        <button
                          className="dashboard-btn dashboard-btn--secondary dashboard-btn--small"
                          onClick={() => void handleDeleteInterviewSlot(slot.id)}
                        >
                          Delete
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}

              <form className="dashboard-form" onSubmit={(e) => void handleCreateInterviewSlot(e)}>
                <div className="dashboard-form-row">
                  <label style={{ flex: 1 }}>
                    Start
                    <input
                      name="startAt"
                      type="datetime-local"
                      className="dashboard-input"
                      required
                    />
                  </label>
                  <label style={{ flex: 1 }}>
                    End
                    <input
                      name="endAt"
                      type="datetime-local"
                      className="dashboard-input"
                      required
                    />
                  </label>
                </div>
                <div className="dashboard-form-row">
                  <label>
                    <input name="supportsOnline" type="checkbox" defaultChecked /> Online
                  </label>
                  <label>
                    <input name="supportsOffline" type="checkbox" /> Offline
                  </label>
                </div>
                <button type="submit" className="dashboard-primary-btn dashboard-primary-btn--small">
                  Add Interview Slot
                </button>
              </form>
            </div>
          )}
        </div>
      )}

      {showCreate && (
        <div className="plan-modal-overlay" onClick={() => setShowCreate(false)}>
          <div className="plan-modal" onClick={(e) => e.stopPropagation()}>
            <h3 className="plan-modal-title">Post a Hiring Need</h3>
            <form className="dashboard-form" onSubmit={(e) => void handleCreate(e)}>
              <input name="title" className="dashboard-input" placeholder="Job title" required />
              <textarea name="description" className="dashboard-textarea" placeholder="Description" required />
              <textarea name="requirements" className="dashboard-textarea" placeholder="Requirements" />
              <input name="salaryRange" className="dashboard-input" placeholder="Salary range" />
              <input
                name="applicationFeeAmount"
                type="number"
                min="0"
                step="0.01"
                className="dashboard-input"
                placeholder="Application fee (USD)"
                required
              />
              <label style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                <input name="interviewEnabled" type="checkbox" /> Enable interviews
              </label>
              <textarea
                name="interviewInstructions"
                className="dashboard-textarea"
                placeholder="Interview instructions (optional)"
              />
              <div className="dashboard-form-row">
                <button type="button" className="plan-modal-cancel" onClick={() => setShowCreate(false)}>
                  Cancel
                </button>
                <button type="submit" className="dashboard-primary-btn" disabled={creating}>
                  {creating ? '...' : 'Post'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      <OnlineCallModal
        open={callReservation != null}
        reservation={callReservation}
        accessToken={accessToken}
        onClose={() => setCallReservation(null)}
        onEnded={() => {
          setCallReservation(null);
          if (selectedJobId) {
            void loadApplications(selectedJobId);
          }
        }}
      />
    </div>
  );
};
