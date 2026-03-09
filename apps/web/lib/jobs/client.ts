import type { CreateJobDto, Job, JobApplication, ApplyJobDto, JobMilestone, CreateMilestoneDto, SubmitMilestoneDto, JobSubmission, JobApplicationMessage } from '@mohandishub/shared';
import { getApiBaseUrl } from '../env';

async function apiReq<T>(path: string, options?: RequestInit): Promise<T> {
  // #region agent log
  fetch('http://127.0.0.1:7325/ingest/ebd08bf8-7d73-450c-ad4d-4436a6c2225b',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'9dfbfc'},body:JSON.stringify({sessionId:'9dfbfc',location:'apps/web/lib/jobs/client.ts:4',message:'apiReq called',data:{path},timestamp:Date.now(),runId:'run1',hypothesisId:'H1'})}).catch(()=>{});
  // #endregion
  const res = await fetch(`${getApiBaseUrl()}${path}`, options);
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = data as { error?: { message?: string } };
    throw new Error(err.error?.message || 'Request failed');
  }
  return (data as { data: T }).data;
}

export const jobsApiClient = {
  async listOpenJobs(page = 1, limit = 20): Promise<{ items: Job[]; total: number; page: number; limit: number; totalPages: number }> {
    return apiReq(`/api/jobs?page=${page}&limit=${limit}`);
  },

  async listBusinessJobs(accessToken: string, page = 1, limit = 20): Promise<{ items: Job[]; total: number; page: number; limit: number; totalPages: number }> {
    return apiReq(`/api/jobs/my?page=${page}&limit=${limit}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
  },

  async createJob(accessToken: string, dto: CreateJobDto): Promise<Job> {
    return apiReq(`/api/jobs`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify(dto),
    });
  },

  async applyForJob(accessToken: string, jobId: string, dto: ApplyJobDto): Promise<JobApplication> {
    return apiReq(`/api/jobs/${jobId}/apply`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify(dto),
    });
  },

  async getJobApplications(accessToken: string, jobId: string): Promise<JobApplication[]> {
    return apiReq(`/api/jobs/${jobId}/applications`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
  },

  async listExpertApplications(accessToken: string): Promise<JobApplication[]> {
    return apiReq(`/api/jobs/my-applications`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
  },

  async updateApplicationStatus(accessToken: string, appId: string, status: string): Promise<JobApplication> {
    return apiReq(`/api/jobs/applications/${appId}/status`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({ status }),
    });
  },

  async closeJob(accessToken: string, jobId: string): Promise<Job> {
    return apiReq(`/api/jobs/${jobId}/close`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}` },
    });
  },

  async createMilestone(accessToken: string, appId: string, dto: CreateMilestoneDto): Promise<JobMilestone> {
    return apiReq(`/api/jobs/applications/${appId}/milestones`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify(dto),
    });
  },

  async getMilestones(accessToken: string, appId: string): Promise<JobMilestone[]> {
    return apiReq(`/api/jobs/applications/${appId}/milestones`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
  },

  async submitMilestone(accessToken: string, milestoneId: string, dto: SubmitMilestoneDto): Promise<JobSubmission> {
    return apiReq(`/api/jobs/milestones/${milestoneId}/submit`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify(dto),
    });
  },

  async reviewMilestone(accessToken: string, milestoneId: string, status: 'approved' | 'rejected'): Promise<JobMilestone> {
    return apiReq(`/api/jobs/milestones/${milestoneId}/review`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({ status }),
    });
  },

  async getApplicationMessages(accessToken: string, appId: string): Promise<JobApplicationMessage[]> {
    return apiReq(`/api/jobs/applications/${appId}/messages`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
  },

  async sendApplicationMessage(accessToken: string, appId: string, content: string): Promise<JobApplicationMessage> {
    return apiReq(`/api/jobs/applications/${appId}/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({ content }),
    });
  },
};
