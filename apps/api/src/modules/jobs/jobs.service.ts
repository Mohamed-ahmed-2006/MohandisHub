import type { Job, JobApplication, CreateJobDto, ApplyJobDto, JobMilestone, JobSubmission, CreateMilestoneDto, SubmitMilestoneDto, JobApplicationMessage } from '@mohandishub/shared';
import { HttpError } from '../../utils/http-error.js';
import { JobsRepository } from './jobs.repository.js';
import type { JobRow, JobApplicationRow, JobMilestoneRow, JobSubmissionRow, JobApplicationMessageRow } from './jobs.repository.js';

import { getSocketServer } from '../../lib/socket-instance.js';

export class JobsService {
  constructor(private readonly repo: JobsRepository = new JobsRepository()) {}

  async createJob(businessId: string, input: CreateJobDto): Promise<Job> {
    const row = await this.repo.createJob(
      businessId,
      input.title,
      input.description,
      input.requirements,
      input.salaryRange
    );
    return this.toJob(row);
  }

  async listOpenJobs(page: number = 1, limit: number = 20) {
    const { rows, total } = await this.repo.listOpenJobs(page, limit);
    return {
      items: rows.map(r => this.toJob(r)),
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  async listBusinessJobs(businessId: string, page: number = 1, limit: number = 20) {
    const { rows, total } = await this.repo.listBusinessJobs(businessId, page, limit);
    return {
      items: rows.map(r => this.toJob(r)),
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  async applyForJob(jobId: string, expertId: string, input: ApplyJobDto): Promise<JobApplication> {
    const job = await this.repo.getJobById(jobId);
    if (!job || job.status !== 'open') {
      throw new HttpError({ statusCode: 400, code: 'JOB_NOT_OPEN', message: 'Job is not open or does not exist.' });
    }
    const app = await this.repo.applyForJob(jobId, expertId, input.coverLetter);
    return this.toApplication(app);
  }

  async getJobApplications(jobId: string, businessId: string): Promise<JobApplication[]> {
    const job = await this.repo.getJobById(jobId);
    if (!job || job.business_id !== businessId) {
      throw new HttpError({ statusCode: 403, code: 'FORBIDDEN', message: 'You do not own this job.' });
    }
    const apps = await this.repo.listJobApplications(jobId);
    return apps.map(a => this.toApplication(a));
  }

  async listExpertApplications(expertId: string): Promise<JobApplication[]> {
    const apps = await this.repo.listExpertApplications(expertId);
    return apps.map(a => this.toApplication(a));
  }

  async updateApplicationStatus(applicationId: string, businessId: string, status: string): Promise<JobApplication> {
    const app = await this.repo.getApplicationById(applicationId);
    if (!app) {
      throw new HttpError({ statusCode: 404, code: 'NOT_FOUND', message: 'Application not found' });
    }
    const job = await this.repo.getJobById(app.job_id);
    if (!job || job.business_id !== businessId) {
      throw new HttpError({ statusCode: 403, code: 'FORBIDDEN', message: 'You do not own this job' });
    }

    const updated = await this.repo.updateApplicationStatus(applicationId, status);
    
    // Notify the expert
    const io = getSocketServer();
    if (io) {
      io.to(`user:${updated.expert_id}`).emit('notification', {
        type: 'application_status',
        title: 'Application Update',
        message: `Your application has been ${status}`,
        jobId: job.id,
      });
    }

    // Auto close other applications if one is accepted (assuming single-freelancer logic per job, though this could be configurable)
    if (status === 'accepted') {
      const allApps = await this.repo.listJobApplications(app.job_id);
      for (const otherApp of allApps) {
        if (otherApp.id !== applicationId && otherApp.status === 'pending') {
          await this.repo.updateApplicationStatus(otherApp.id, 'rejected');
        }
      }
    }

    return this.toApplication(updated);
  }

  async createMilestone(applicationId: string, businessId: string, input: CreateMilestoneDto): Promise<JobMilestone> {
    const app = await this.repo.getApplicationById(applicationId);
    if (!app) {
      throw new HttpError({ statusCode: 404, code: 'NOT_FOUND', message: 'Application not found' });
    }
    const job = await this.repo.getJobById(app.job_id);
    if (!job || job.business_id !== businessId) {
      throw new HttpError({ statusCode: 403, code: 'FORBIDDEN', message: 'You do not own this job' });
    }
    
    if (job.status === 'closed') {
      throw new HttpError({ statusCode: 400, code: 'JOB_CLOSED', message: 'Job is closed' });
    }
    
    const milestone = await this.repo.createMilestone(applicationId, input.title, input.amount);
    return this.toMilestone(milestone);
  }

  async getMilestones(applicationId: string, userId: string): Promise<JobMilestone[]> {
    const app = await this.repo.getApplicationById(applicationId);
    if (!app) {
      throw new HttpError({ statusCode: 404, code: 'NOT_FOUND', message: 'Application not found' });
    }
    const job = await this.repo.getJobById(app.job_id);
    if (!job) {
      throw new HttpError({ statusCode: 404, code: 'NOT_FOUND', message: 'Job not found' });
    }
    
    // Check if the user is either the business or the expert
    if (job.business_id !== userId && app.expert_id !== userId) {
      throw new HttpError({ statusCode: 403, code: 'FORBIDDEN', message: 'You are not authorized to view these milestones' });
    }

    const milestones = await this.repo.listMilestones(applicationId);
    return milestones.map(m => this.toMilestone(m));
  }

  async submitMilestone(milestoneId: string, expertId: string, input: SubmitMilestoneDto): Promise<JobSubmission> {
    const milestone = await this.repo.getMilestoneById(milestoneId);
    if (!milestone) {
      throw new HttpError({ statusCode: 404, code: 'NOT_FOUND', message: 'Milestone not found' });
    }
    const app = await this.repo.getApplicationById(milestone.job_application_id);
    if (!app || app.expert_id !== expertId) {
      throw new HttpError({ statusCode: 403, code: 'FORBIDDEN', message: 'You are not the expert for this application' });
    }
    if (milestone.status !== 'pending' && milestone.status !== 'active' && milestone.status !== 'rejected') {
      throw new HttpError({ statusCode: 400, code: 'BAD_REQUEST', message: 'Milestone is not in a submittable state' });
    }

    const job = await this.repo.getJobById(app.job_id);
    if (!job) {
      throw new HttpError({ statusCode: 404, code: 'NOT_FOUND', message: 'Job not found' });
    }
    if (job.status === 'closed') {
      throw new HttpError({ statusCode: 400, code: 'JOB_CLOSED', message: 'Job is closed' });
    }
    
    const submission = await this.repo.createSubmission(milestoneId, input.submissionNotes, input.attachments);
    await this.repo.updateMilestoneStatus(milestoneId, 'submitted');
    
    // Notify the business
    const io = getSocketServer();
    if (io) {
      const job = await this.repo.getJobById(app.job_id);
      if (job) {
        io.to(`user:${job.business_id}`).emit('notification', {
          type: 'milestone_submitted',
          title: 'Milestone Submitted',
          message: `Work submitted for milestone: ${milestone.title}`,
          applicationId: app.id,
        });
      }
    }
    
    return this.toSubmission(submission);
  }

  async reviewMilestone(milestoneId: string, businessId: string, status: 'approved' | 'rejected'): Promise<JobMilestone> {
    const milestone = await this.repo.getMilestoneById(milestoneId);
    if (!milestone) {
      throw new HttpError({ statusCode: 404, code: 'NOT_FOUND', message: 'Milestone not found' });
    }
    const app = await this.repo.getApplicationById(milestone.job_application_id);
    if (!app) {
      throw new HttpError({ statusCode: 404, code: 'NOT_FOUND', message: 'Application not found' });
    }
    const job = await this.repo.getJobById(app.job_id);
    if (!job || job.business_id !== businessId) {
      throw new HttpError({ statusCode: 403, code: 'FORBIDDEN', message: 'You do not own this job' });
    }
    if (milestone.status !== 'submitted') {
      throw new HttpError({ statusCode: 400, code: 'BAD_REQUEST', message: 'Milestone is not pending review' });
    }

    if (job.status === 'closed') {
      throw new HttpError({ statusCode: 400, code: 'JOB_CLOSED', message: 'Job is closed' });
    }
    
    const updated = await this.repo.updateMilestoneStatus(milestoneId, status);
    
    // Notify the expert
    const io = getSocketServer();
    if (io) {
      io.to(`user:${app.expert_id}`).emit('notification', {
        type: 'milestone_reviewed',
        title: 'Milestone Reviewed',
        message: `Your milestone "${milestone.title}" was ${status}`,
        applicationId: app.id,
      });
    }

    return this.toMilestone(updated);
  }

  async getApplicationMessages(applicationId: string, userId: string): Promise<JobApplicationMessage[]> {
    const app = await this.repo.getApplicationById(applicationId);
    if (!app) {
      throw new HttpError({ statusCode: 404, code: 'NOT_FOUND', message: 'Application not found' });
    }
    const job = await this.repo.getJobById(app.job_id);
    if (!job) {
      throw new HttpError({ statusCode: 404, code: 'NOT_FOUND', message: 'Job not found' });
    }
    if (job.business_id !== userId && app.expert_id !== userId) {
      throw new HttpError({ statusCode: 403, code: 'FORBIDDEN', message: 'You are not authorized' });
    }

    const messages = await this.repo.listApplicationMessages(applicationId);
    return messages.map(m => this.toApplicationMessage(m));
  }

  async sendApplicationMessage(applicationId: string, userId: string, content: string): Promise<JobApplicationMessage> {
    const app = await this.repo.getApplicationById(applicationId);
    if (!app) {
      throw new HttpError({ statusCode: 404, code: 'NOT_FOUND', message: 'Application not found' });
    }
    const job = await this.repo.getJobById(app.job_id);
    if (!job) {
      throw new HttpError({ statusCode: 404, code: 'NOT_FOUND', message: 'Job not found' });
    }
    if (job.business_id !== userId && app.expert_id !== userId) {
      throw new HttpError({ statusCode: 403, code: 'FORBIDDEN', message: 'You are not authorized' });
    }

    const msg = await this.repo.createApplicationMessage(applicationId, userId, content);
    const msgDto = this.toApplicationMessage(msg);
    
    // Notify application room
    const io = getSocketServer();
    if (io) {
      io.to(`application:${applicationId}`).emit('new_application_message', msgDto);
      
      // Notify the other party
      const targetUserId = userId === app.expert_id ? job.business_id : app.expert_id;
      io.to(`user:${targetUserId}`).emit('notification', {
        type: 'new_message',
        title: 'New Message',
        message: `New message on job application`,
        applicationId,
      });
    }

    return msgDto;
  }

  async closeJob(jobId: string, businessId: string): Promise<Job> {
    const updated = await this.repo.updateJobStatus(jobId, businessId, 'closed');
    if (!updated) {
      throw new HttpError({ statusCode: 404, code: 'NOT_FOUND', message: 'Job not found or unauthorized' });
    }
    return this.toJob(updated);
  }

  private toJob(row: JobRow): Job {
    return {
      id: row.id,
      businessId: row.business_id,
      businessName: row.business_name,
      title: row.title,
      description: row.description,
      requirements: row.requirements,
      salaryRange: row.salary_range,
      status: row.status as Job['status'],
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  private toApplication(row: JobApplicationRow): JobApplication {
    return {
      id: row.id,
      jobId: row.job_id,
      expertId: row.expert_id,
      expertName: row.expert_name,
      coverLetter: row.cover_letter,
      status: row.status as JobApplication['status'],
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  private toMilestone(row: JobMilestoneRow): JobMilestone {
    return {
      id: row.id,
      jobApplicationId: row.job_application_id,
      title: row.title,
      amount: row.amount,
      status: row.status as JobMilestone['status'],
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  private toSubmission(row: JobSubmissionRow): JobSubmission {
    return {
      id: row.id,
      milestoneId: row.milestone_id,
      submissionNotes: row.submission_notes,
      attachments: row.attachments,
      createdAt: row.created_at,
    };
  }

  private toApplicationMessage(row: JobApplicationMessageRow): JobApplicationMessage {
    return {
      id: row.id,
      jobApplicationId: row.job_application_id,
      senderId: row.sender_id,
      content: row.content,
      createdAt: row.created_at,
      ...(row.sender_name ? { senderName: row.sender_name } : {}),
    };
  }
}
