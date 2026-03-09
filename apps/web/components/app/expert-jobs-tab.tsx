'use client';

import type { Job } from '@mohandishub/shared';
import { useCallback, useEffect, useState } from 'react';
import { jobsApiClient } from '@/lib/jobs/client';
import { JobCard } from './jobs/job-card';
import { ExpertApplications } from './jobs/expert-applications';

export const ExpertJobsTab = ({ accessToken }: { accessToken: string }) => {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(true);
  const [applyJobId, setApplyJobId] = useState<string | null>(null);
  const [applying, setApplying] = useState(false);

  const loadJobs = useCallback(async () => {
    try {
      const res = await jobsApiClient.listOpenJobs(1, 50);
      setJobs(res.items);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadJobs();
  }, [loadJobs]);

  const handleApply = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!applyJobId) return;
    setApplying(true);
    const form = e.currentTarget;
    try {
      await jobsApiClient.applyForJob(accessToken, applyJobId, {
        coverLetter: (form.elements.namedItem('coverLetter') as HTMLTextAreaElement).value,
      });
      setApplyJobId(null);
      alert('Applied successfully!');
    } catch (err: any) {
      alert(err.message || 'Failed to apply');
    } finally {
      setApplying(false);
    }
  };

  if (loading) return <p>Loading jobs...</p>;

  return (
    <div className="dashboard-section">
      <h3 className="dashboard-section-title">Available Jobs</h3>
      {jobs.length === 0 ? <p className="dashboard-empty">No open jobs found.</p> : (
        <div className="dashboard-cards">
          {jobs.map(job => (
            <JobCard key={job.id} job={job}>
              <button className="dashboard-primary-btn" onClick={() => setApplyJobId(job.id)}>Apply</button>
            </JobCard>
          ))}
        </div>
      )}

      {applyJobId && (
        <div className="plan-modal-overlay" onClick={() => setApplyJobId(null)}>
          <div className="plan-modal" onClick={e => e.stopPropagation()}>
            <h3 className="plan-modal-title">Apply for Job</h3>
            <form className="dashboard-form" onSubmit={(e) => void handleApply(e)}>
              <textarea name="coverLetter" className="dashboard-textarea" placeholder="Why are you a good fit?" required />
              <div className="dashboard-form-row">
                <button type="button" className="plan-modal-cancel" onClick={() => setApplyJobId(null)}>Cancel</button>
                <button type="submit" className="dashboard-primary-btn" disabled={applying}>{applying ? '...' : 'Submit Application'}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      <ExpertApplications accessToken={accessToken} />
    </div>
  );
};
