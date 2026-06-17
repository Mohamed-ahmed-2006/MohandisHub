import type { Job } from '@mohandishub/shared';

import type { JobsCopy } from './jobs-copy';

type JobCardProps = {
  job: Job;
  copy: JobsCopy;
  children?: React.ReactNode;
};

export const JobCard = ({ job, copy, children }: JobCardProps) => {
  return (
    <div className="dashboard-card">
      <h4 className="dashboard-card-title">{job.title}</h4>
      <p className="dashboard-card-meta">
        {job.businessName || job.businessId} | {job.salaryRange || copy.noRange} |{' '}
        {copy.statusLabels[job.status] ?? job.status}
      </p>
      <p className="dashboard-card-desc">{job.description}</p>
      <p className="dashboard-card-meta">
        {copy.applicationFee}: {job.applicationFeeAmount.toFixed(2)} EGP |{' '}
        {job.interviewEnabled ? copy.interviewsEnabled : copy.interviewsDisabled}
      </p>
      {job.interviewInstructions && (
        <p className="dashboard-card-meta">{job.interviewInstructions}</p>
      )}
      <div className="dashboard-card-actions">{children}</div>
    </div>
  );
};
