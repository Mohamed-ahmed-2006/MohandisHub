'use client';

import { useCallback, useEffect, useState } from 'react';
import type { JobApplication, JobMilestone } from '@mohandishub/shared';
import { jobsApiClient } from '@/lib/jobs/client';
import { ApplicationChat } from './application-chat';

export const ExpertApplications = ({ accessToken }: { accessToken: string }) => {
  const [applications, setApplications] = useState<JobApplication[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedApp, setSelectedApp] = useState<string | null>(null);
  const [milestones, setMilestones] = useState<JobMilestone[]>([]);

  const loadApplications = useCallback(async () => {
    try {
      const res = await jobsApiClient.listExpertApplications(accessToken);
      setApplications(res);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, [accessToken]);

  useEffect(() => {
    void loadApplications();
  }, [loadApplications]);

  const loadMilestones = useCallback(async (appId: string) => {
    try {
      const res = await jobsApiClient.getMilestones(accessToken, appId);
      setMilestones(res);
    } catch {
      // ignore
    }
  }, [accessToken]);

  const handleSubmitMilestone = async (milestoneId: string, notes: string) => {
    try {
      await jobsApiClient.submitMilestone(accessToken, milestoneId, { submissionNotes: notes });
      alert('Milestone submitted');
      if (selectedApp) void loadMilestones(selectedApp);
    } catch (err: any) {
      alert(err.message || 'Failed to submit milestone');
    }
  };

  if (loading) return <p>Loading my applications...</p>;

  return (
    <div className="dashboard-section" style={{ marginTop: '2rem' }}>
      <h3 className="dashboard-section-title">My Applications</h3>
      {applications.length === 0 ? <p className="dashboard-empty">No applications yet.</p> : (
        <ul style={{ listStyle: 'none', padding: 0 }}>
          {applications.map(app => (
            <li key={app.id} style={{ marginBottom: '1rem', padding: '1rem', background: '#f9f9f9', borderRadius: '8px', border: '1px solid #eee' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <strong>Job ID: {app.jobId}</strong>
                <span className={`badge badge--${app.status}`}>{app.status}</span>
              </div>
              <p style={{ fontSize: '0.95rem', margin: '0.5rem 0' }}>{app.coverLetter}</p>

              {app.status === 'accepted' && (
                <div style={{ marginTop: '1rem' }}>
                  <button 
                    className="dashboard-link-btn"
                    onClick={() => {
                      setSelectedApp(selectedApp === app.id ? null : app.id);
                      if (selectedApp !== app.id) void loadMilestones(app.id);
                    }}
                  >
                    {selectedApp === app.id ? 'Hide Project Details' : 'View Project Details'}
                  </button>

                  {selectedApp === app.id && (
                    <div style={{ marginTop: '1rem', padding: '1rem', background: '#fff', border: '1px solid #ddd', borderRadius: '4px' }}>
                      <h4 style={{ marginBottom: '1rem' }}>Project Milestones</h4>
                      {milestones.length === 0 ? <p>No milestones created yet.</p> : (
                        <ul style={{ listStyle: 'none', padding: 0 }}>
                          {milestones.map(m => (
                            <li key={m.id} style={{ marginBottom: '1rem', paddingBottom: '1rem', borderBottom: '1px solid #eee' }}>
                              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
                                <strong>{m.title}</strong>
                                <span>{m.amount} EGP - <span className={`badge badge--${m.status}`}>{m.status}</span></span>
                              </div>
                              
                              {(m.status === 'pending' || m.status === 'active' || m.status === 'rejected') && (
                                <form 
                                  style={{ marginTop: '0.5rem', display: 'flex', gap: '0.5rem' }}
                                  onSubmit={(e) => {
                                    e.preventDefault();
                                    const form = e.currentTarget;
                                    const notes = (form.elements.namedItem('notes') as HTMLInputElement).value;
                                    void handleSubmitMilestone(m.id, notes);
                                  }}
                                >
                                  <input name="notes" className="dashboard-input" placeholder="Submission notes/link" required style={{ flex: 1 }} />
                                  <button type="submit" className="dashboard-primary-btn dashboard-primary-btn--small">Submit</button>
                                </form>
                              )}
                            </li>
                          ))}
                        </ul>
                      )}
                      
                      <div style={{ marginTop: '2rem' }}>
                        <h4>Project Chat</h4>
                        <ApplicationChat applicationId={app.id} />
                      </div>
                    </div>
                  )}
                </div>
              )}
              {app.status === 'pending' && (
                <div style={{ marginTop: '1rem' }}>
                  <button 
                    className="dashboard-link-btn"
                    onClick={() => {
                      setSelectedApp(selectedApp === app.id ? null : app.id);
                    }}
                  >
                    {selectedApp === app.id ? 'Hide Pre-Award Chat' : 'Open Pre-Award Chat'}
                  </button>
                  {selectedApp === app.id && (
                    <div style={{ marginTop: '1rem' }}>
                      <ApplicationChat applicationId={app.id} />
                    </div>
                  )}
                </div>
              )}

            </li>
          ))}
        </ul>
      )}
    </div>
  );
};
