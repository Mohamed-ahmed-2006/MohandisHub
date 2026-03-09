'use client';

import type { Job, JobApplication } from '@mohandishub/shared';
import { useCallback, useEffect, useState } from 'react';
import { jobsApiClient } from '@/lib/jobs/client';
import { JobCard } from './jobs/job-card';
import { ApplicationItem } from './jobs/application-item';
import { BusinessMilestoneManager } from './jobs/business-milestone-manager';
import { ApplicationChat } from './jobs/application-chat';

export const BusinessJobsTab = ({ accessToken }: { accessToken: string }) => {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [creating, setCreating] = useState(false);
  const [selectedJob, setSelectedJob] = useState<string | null>(null);
  const [applications, setApplications] = useState<JobApplication[]>([]);

  const loadJobs = useCallback(async () => {
    try {
      const res = await jobsApiClient.listBusinessJobs(accessToken, 1, 50);
      setJobs(res.items);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, [accessToken]);

  useEffect(() => {
    void loadJobs();
  }, [loadJobs]);

  const loadApplications = useCallback(async (jobId: string) => {
    try {
      const apps = await jobsApiClient.getJobApplications(accessToken, jobId);
      setApplications(apps);
    } catch {
      // ignore
    }
  }, [accessToken]);

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
      });
      setShowCreate(false);
      void loadJobs();
    } catch {
      // ignore
    } finally {
      setCreating(false);
    }
  };

  const handleUpdateApp = async (appId: string, status: string) => {
    try {
      await jobsApiClient.updateApplicationStatus(accessToken, appId, status);
      if (selectedJob) void loadApplications(selectedJob);
    } catch {
      // ignore
    }
  };

  if (loading) return <p>Loading jobs...</p>;

  return (
    <div className="dashboard-section">
      <div className="dashboard-section-header">
        <h3 className="dashboard-section-title">My Job Postings</h3>
        <button className="dashboard-primary-btn" onClick={() => setShowCreate(true)}>Post a Job</button>
      </div>

      <div className="dashboard-cards">
        {jobs.map(job => (
          <JobCard key={job.id} job={job}>
            <button 
              className="dashboard-link-btn" 
              onClick={() => {
                setSelectedJob(selectedJob === job.id ? null : job.id);
                if (selectedJob !== job.id) void loadApplications(job.id);
              }}
            >
              {selectedJob === job.id ? 'Hide Applications' : 'View Applications'}
            </button>

            {selectedJob === job.id && (
              <div style={{ marginTop: '1rem', borderTop: '1px solid #ccc', paddingTop: '1rem', width: '100%' }}>
                <h5>Applications</h5>
                {applications.length === 0 ? <p>No applications yet.</p> : (
                  <ul style={{ listStyle: 'none', padding: 0 }}>
                    {applications.map(app => (
                      <ApplicationItem 
                        key={app.id} 
                        app={app} 
                        onAccept={(id) => handleUpdateApp(id, 'accepted')}
                        onReject={(id) => handleUpdateApp(id, 'rejected')}
                      >
                        {app.status === 'accepted' && (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                            <BusinessMilestoneManager accessToken={accessToken} applicationId={app.id} />
                            <div style={{ marginTop: '1rem' }}>
                              <h4>Project Chat</h4>
                              <ApplicationChat applicationId={app.id} />
                            </div>
                          </div>
                        )}
                        {app.status === 'pending' && (
                          <div style={{ marginTop: '1rem' }}>
                            <h4>Pre-Award Chat</h4>
                            <ApplicationChat applicationId={app.id} />
                          </div>
                        )}
                      </ApplicationItem>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </JobCard>
        ))}
      </div>

      {showCreate && (
        <div className="plan-modal-overlay" onClick={() => setShowCreate(false)}>
          <div className="plan-modal" onClick={e => e.stopPropagation()}>
            <h3 className="plan-modal-title">Post a New Job</h3>
            <form className="dashboard-form" onSubmit={(e) => void handleCreate(e)}>
              <input name="title" className="dashboard-input" placeholder="Job Title" required />
              <textarea name="description" className="dashboard-textarea" placeholder="Job Description" required />
              <textarea name="requirements" className="dashboard-textarea" placeholder="Requirements" />
              <input name="salaryRange" className="dashboard-input" placeholder="Salary Range (e.g. 5000-10000 EGP)" />
              <div className="dashboard-form-row">
                <button type="button" className="plan-modal-cancel" onClick={() => setShowCreate(false)}>Cancel</button>
                <button type="submit" className="dashboard-primary-btn" disabled={creating}>{creating ? '...' : 'Post Job'}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
