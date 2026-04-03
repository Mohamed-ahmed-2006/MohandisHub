import type {
  ApplyJobDto,
  BookJobInterviewDto,
  CreateJobDto,
  CreateJobInterviewSlotDto,
  CreateMilestoneDto,
  Job,
  JobApplication,
  JobApplicationMessage,
  JobMilestone,
  JobSubmission,
  Reservation,
  ReservationSlot,
  SubmitMilestoneDto,
  UpdateJobInterviewSlotDto,
} from '@mohandishub/shared';

import { getApiBaseUrl } from '../env';

const createIdempotencyKey = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}`;

async function apiReq<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${getApiBaseUrl()}${path}`, options);
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

  async createInterviewSlot(
    accessToken: string,
    jobId: string,
    dto: CreateJobInterviewSlotDto,
  ): Promise<ReservationSlot> {
    return apiReq(`/api/jobs/${jobId}/interview-slots`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify(dto),
    });
  },

  async listBusinessInterviewSlots(
    accessToken: string,
    jobId: string,
    params?: { from?: string; to?: string },
  ): Promise<{ items: ReservationSlot[] }> {
    const query = new URLSearchParams();
    if (params?.from) query.set('from', params.from);
    if (params?.to) query.set('to', params.to);
    return apiReq(`/api/jobs/${jobId}/interview-slots${query.toString() ? `?${query.toString()}` : ''}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
  },

  async updateInterviewSlot(
    accessToken: string,
    slotId: string,
    dto: UpdateJobInterviewSlotDto,
  ): Promise<ReservationSlot> {
    return apiReq(`/api/jobs/interview-slots/${slotId}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify(dto),
    });
  },

  async deleteInterviewSlot(accessToken: string, slotId: string): Promise<{ deleted: boolean }> {
    return apiReq(`/api/jobs/interview-slots/${slotId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${accessToken}` },
    });
  },

  async listApplicationInterviewSlots(
    accessToken: string,
    appId: string,
  ): Promise<{ items: ReservationSlot[] }> {
    return apiReq(`/api/jobs/applications/${appId}/interview-slots`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
  },

  async bookInterview(
    accessToken: string,
    appId: string,
    dto: BookJobInterviewDto,
  ): Promise<Reservation> {
    return apiReq(`/api/jobs/applications/${appId}/interview-book`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
        'Idempotency-Key': createIdempotencyKey(),
      },
      body: JSON.stringify(dto),
    });
  },
};
