'use client';

import type { Job } from '@mohandishub/shared';
import { useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';

import { ExpertApplications } from './jobs/expert-applications';
import { JobCard } from './jobs/job-card';

import { getJobsCopy, interpolate } from '@/components/app/jobs/jobs-copy';
import { useToast } from '@/components/app/toast';
import type { Dictionary } from '@/lib/i18n/types';
import { jobsApiClient } from '@/lib/jobs/client';
import { uploadPrivateFile } from '@/lib/upload/client';

export const ExpertJobsTab = ({
  accessToken,
  dictionary,
}: {
  accessToken: string;
  dictionary?: Dictionary;
}) => {
  const { addToast } = useToast();
  const searchParams = useSearchParams();
  const copy = getJobsCopy(dictionary);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(true);
  const [applyJob, setApplyJob] = useState<Job | null>(null);
  const [applying, setApplying] = useState(false);
  const [submissionType, setSubmissionType] = useState<'profile_snapshot' | 'cv_upload'>(
    'profile_snapshot',
  );
  const [cvFile, setCvFile] = useState<File | null>(null);

  const loadJobs = useCallback(async () => {
    try {
      const res = await jobsApiClient.listOpenJobs(1, 50);
      setJobs(res.items);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadJobs();
  }, [loadJobs]);

  useEffect(() => {
    if (searchParams.get('application')) return;
    const jobId = searchParams.get('job');
    if (!jobId || loading || applyJob?.id === jobId) return;
    const job = jobs.find((item) => item.id === jobId);
    if (job) setApplyJob(job);
  }, [applyJob?.id, jobs, loading, searchParams]);

  const handleApply = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!applyJob) return;
    setApplying(true);
    const form = e.currentTarget;
    try {
      let cvFileUrl: string | undefined;
      if (submissionType === 'cv_upload') {
        if (!cvFile) {
          throw new Error(copy.chooseCvError);
        }
        const uploaded = await uploadPrivateFile(accessToken, cvFile);
        cvFileUrl = uploaded.url;
      }

      await jobsApiClient.applyForJob(accessToken, applyJob.id, {
        coverLetter: (form.elements.namedItem('coverLetter') as HTMLTextAreaElement).value,
        submissionType,
        ...(cvFileUrl ? { cvFileUrl } : {}),
      });

      setApplyJob(null);
      setSubmissionType('profile_snapshot');
      setCvFile(null);
      await loadJobs();
      addToast('Success', copy.applicationSubmitted);
    } catch (err: unknown) {
      addToast('Error', err instanceof Error ? err.message : copy.failedToApply);
    } finally {
      setApplying(false);
    }
  };

  if (loading) return <p>{copy.loadingJobs}</p>;

  return (
    <div className="dashboard-section">
      <h3 className="dashboard-section-title">{copy.expertTitle}</h3>
      {jobs.length === 0 ? (
        <p className="dashboard-empty">{copy.noOpenJobs}</p>
      ) : (
        <div className="dashboard-cards">
          {jobs.map((job) => (
            <JobCard key={job.id} job={job} copy={copy}>
              <button className="dashboard-primary-btn" onClick={() => setApplyJob(job)}>
                {copy.apply}
              </button>
            </JobCard>
          ))}
        </div>
      )}

      {applyJob && (
        <div className="plan-modal-overlay" onClick={() => setApplyJob(null)}>
          <div className="plan-modal" onClick={(e) => e.stopPropagation()}>
            <h3 className="plan-modal-title">
              {copy.applyFor} {applyJob.title}
            </h3>
            <p className="dashboard-card-meta">
              {interpolate(copy.applyChargeNotice, {
                amount: applyJob.applicationFeeAmount.toFixed(2),
              })}
            </p>
            {applyJob.interviewEnabled && applyJob.interviewInstructions && (
              <p className="dashboard-card-meta">{applyJob.interviewInstructions}</p>
            )}
            <form className="dashboard-form" onSubmit={(e) => void handleApply(e)}>
              <div style={{ display: 'flex', gap: '1rem' }}>
                <label style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                  <input
                    type="radio"
                    name="submissionType"
                    checked={submissionType === 'profile_snapshot'}
                    onChange={() => setSubmissionType('profile_snapshot')}
                  />
                  {copy.appProfile}
                </label>
                <label style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                  <input
                    type="radio"
                    name="submissionType"
                    checked={submissionType === 'cv_upload'}
                    onChange={() => setSubmissionType('cv_upload')}
                  />
                  {copy.cvUpload}
                </label>
              </div>
              {submissionType === 'cv_upload' && (
                <input
                  type="file"
                  accept=".pdf,.png,.jpg,.jpeg,.webp"
                  className="dashboard-input"
                  onChange={(event) => setCvFile(event.target.files?.[0] ?? null)}
                  required
                />
              )}
              <textarea
                name="coverLetter"
                className="dashboard-textarea"
                placeholder={copy.coverLetterPlaceholder}
                required
              />
              <div className="dashboard-form-row">
                <button
                  type="button"
                  className="plan-modal-cancel"
                  onClick={() => setApplyJob(null)}
                >
                  {copy.cancel}
                </button>
                <button type="submit" className="dashboard-primary-btn" disabled={applying}>
                  {applying
                    ? copy.creating
                    : interpolate(copy.payAndSubmit, {
                        amount: applyJob.applicationFeeAmount.toFixed(2),
                      })}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      <ExpertApplications accessToken={accessToken} copy={copy} />
    </div>
  );
};
