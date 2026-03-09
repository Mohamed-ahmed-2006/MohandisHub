import type { CreateJobDto, Job, JobApplication, ApplyJobDto, JobMilestone, CreateMilestoneDto, SubmitMilestoneDto, JobSubmission, JobApplicationMessage } from '@mohandishub/shared';
import { getApiBaseUrl } from '../env';

export const jobsApiClient = {
  async listOpenJobs(page = 1, limit = 20): Promise<{ items: Job[]; total: number; page: number; limit: number; totalPages: number }> {
    const res = await fetch(`${getApiBaseUrl()}/api/jobs?page=${page}&limit=${limit}`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error?.message || 'Failed to list open jobs');
    return data.data;
  },

  async listBusinessJobs(accessToken: string, page = 1, limit = 20): Promise<{ items: Job[]; total: number; page: number; limit: number; totalPages: number }> {
    const res = await fetch(`${getApiBaseUrl()}/api/jobs/my?page=${page}&limit=${limit}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error?.message || 'Failed to list my jobs');
    return data.data;
  },

  async createJob(accessToken: string, dto: CreateJobDto): Promise<Job> {
    const res = await fetch(`${getApiBaseUrl()}/api/jobs`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify(dto),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error?.message || 'Failed to create job');
    return data.data;
  },

  async applyForJob(accessToken: string, jobId: string, dto: ApplyJobDto): Promise<JobApplication> {
    const res = await fetch(`${getApiBaseUrl()}/api/jobs/${jobId}/apply`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify(dto),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error?.message || 'Failed to apply for job');
    return data.data;
  },

  async getJobApplications(accessToken: string, jobId: string): Promise<JobApplication[]> {
    const res = await fetch(`${getApiBaseUrl()}/api/jobs/${jobId}/applications`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error?.message || 'Failed to get applications');
    return data.data;
  },

  async listExpertApplications(accessToken: string): Promise<JobApplication[]> {
    const res = await fetch(`${getApiBaseUrl()}/api/jobs/my-applications`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error?.message || 'Failed to get applications');
    return data.data;
  },

  async updateApplicationStatus(accessToken: string, appId: string, status: string): Promise<JobApplication> {
    const res = await fetch(`${getApiBaseUrl()}/api/jobs/applications/${appId}/status`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({ status }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error?.message || 'Failed to update application');
    return data.data;
  },

  async closeJob(accessToken: string, jobId: string): Promise<Job> {
    const res = await fetch(`${getApiBaseUrl()}/api/jobs/${jobId}/close`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error?.message || 'Failed to close job');
    return data.data;
  },

  async createMilestone(accessToken: string, appId: string, dto: CreateMilestoneDto): Promise<JobMilestone> {
    const res = await fetch(`${getApiBaseUrl()}/api/jobs/applications/${appId}/milestones`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify(dto),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error?.message || 'Failed to create milestone');
    return data.data;
  },

  async getMilestones(accessToken: string, appId: string): Promise<JobMilestone[]> {
    const res = await fetch(`${getApiBaseUrl()}/api/jobs/applications/${appId}/milestones`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error?.message || 'Failed to get milestones');
    return data.data;
  },

  async submitMilestone(accessToken: string, milestoneId: string, dto: SubmitMilestoneDto): Promise<JobSubmission> {
    const res = await fetch(`${getApiBaseUrl()}/api/jobs/milestones/${milestoneId}/submit`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify(dto),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error?.message || 'Failed to submit milestone');
    return data.data;
  },

  async reviewMilestone(accessToken: string, milestoneId: string, status: 'approved' | 'rejected'): Promise<JobMilestone> {
    const res = await fetch(`${getApiBaseUrl()}/api/jobs/milestones/${milestoneId}/review`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({ status }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error?.message || 'Failed to review milestone');
    return data.data;
  },

  async getApplicationMessages(accessToken: string, appId: string): Promise<JobApplicationMessage[]> {
    const res = await fetch(`${getApiBaseUrl()}/api/jobs/applications/${appId}/messages`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error?.message || 'Failed to get messages');
    return data.data;
  },

  async sendApplicationMessage(accessToken: string, appId: string, content: string): Promise<JobApplicationMessage> {
    const res = await fetch(`${getApiBaseUrl()}/api/jobs/applications/${appId}/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({ content }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error?.message || 'Failed to send message');
    return data.data;
  },
};
