import type { Job } from '@mohandishub/shared';

type JobCardProps = {
  job: Job;
  children?: React.ReactNode;
};

export const JobCard = ({ job, children }: JobCardProps) => {
  return (
    <div className="dashboard-card">
      <h4 className="dashboard-card-title">{job.title}</h4>
      <p className="dashboard-card-meta">
        {job.businessName || job.businessId} | {job.salaryRange || 'No range'} | {job.status}
      </p>
      <p className="dashboard-card-desc">{job.description}</p>
      <p className="dashboard-card-meta">
        Application fee: {job.applicationFeeAmount.toFixed(2)} EGP |{' '}
        {job.interviewEnabled ? 'Interviews enabled' : 'Interviews disabled'}
      </p>
      {job.interviewInstructions && (
        <p className="dashboard-card-meta">{job.interviewInstructions}</p>
      )}
      <div className="dashboard-card-actions">{children}</div>
    </div>
  );
};
