import type { Job, JobApplication, CreateJobDto, ApplyJobDto, JobMilestone, JobSubmission, CreateMilestoneDto, SubmitMilestoneDto, JobApplicationMessage } from '@mohandishub/shared';
import type { PoolClient } from 'pg';

import { getPool } from '../../db/pool.js';
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
    try {
      const app = await this.repo.applyForJob(jobId, expertId, input.coverLetter);
      return this.toApplication(app);
    } catch (err: unknown) {
      const pgErr = err as { code?: string };
      if (pgErr.code === '23505') {
        throw new HttpError({
          statusCode: 409,
          code: 'DUPLICATE_APPLICATION',
          message: 'You already applied for this job.',
        });
      }
      throw err;
    }
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
    const allowedStatus = new Set(['pending', 'reviewed', 'accepted', 'rejected']);
    if (!allowedStatus.has(status)) {
      throw new HttpError({
        statusCode: 400,
        code: 'INVALID_APPLICATION_STATUS',
        message: 'Invalid application status.',
      });
    }

    const pool = getPool();
    const client = await pool.connect();
    let updated: JobApplicationRow | null = null;
    let job: JobRow | null = null;
    try {
      await client.query('BEGIN');

      const app = await this.findApplicationForUpdate(client, applicationId);
      if (!app) {
        throw new HttpError({ statusCode: 404, code: 'NOT_FOUND', message: 'Application not found' });
      }
      job = await this.findJobForUpdate(client, app.job_id);
      if (!job || job.business_id !== businessId) {
        throw new HttpError({ statusCode: 403, code: 'FORBIDDEN', message: 'You do not own this job' });
      }

      if (status === 'accepted') {
        const jobApplications = await this.listApplicationsByJobForUpdate(client, app.job_id);
        const currentAccepted = jobApplications.find((row) => row.status === 'accepted' && row.id !== app.id);

        if (currentAccepted) {
          const started = await this.hasApplicationWorkStarted(client, currentAccepted.id);
          if (started) {
            throw new HttpError({
              statusCode: 409,
              code: 'APPLICATION_REPLACEMENT_BLOCKED',
              message: 'Cannot replace accepted application after work has started.',
            });
          }
        }

        await client.query(
          `UPDATE job_applications
           SET status = 'accepted', updated_at = now()
           WHERE id = $1`,
          [applicationId],
        );
        await client.query(
          `UPDATE job_applications
           SET status = 'rejected', updated_at = now()
           WHERE job_id = $1
             AND id != $2
             AND status IN ('pending', 'reviewed', 'accepted')`,
          [app.job_id, applicationId],
        );
      } else {
        if (app.status === 'accepted' && status !== 'accepted') {
          const started = await this.hasApplicationWorkStarted(client, app.id);
          if (started) {
            throw new HttpError({
              statusCode: 409,
              code: 'APPLICATION_REPLACEMENT_BLOCKED',
              message: 'Cannot change accepted application after work has started.',
            });
          }
        }
        await client.query(
          `UPDATE job_applications
           SET status = $2, updated_at = now()
           WHERE id = $1`,
          [applicationId, status],
        );
      }

      updated = await this.findApplicationForUpdate(client, applicationId);
      await client.query('COMMIT');
    } catch (err: unknown) {
      await client.query('ROLLBACK');
      const pgErr = err as { code?: string; constraint?: string };
      if (
        pgErr.code === '23505' &&
        pgErr.constraint === 'uniq_job_applications_one_accepted_per_job'
      ) {
        throw new HttpError({
          statusCode: 409,
          code: 'APPLICATION_ACCEPT_CONFLICT',
          message: 'Another application was accepted for this job.',
        });
      }
      throw err;
    } finally {
      client.release();
    }

    if (!updated || !job) {
      throw new HttpError({ statusCode: 500, code: 'INTERNAL_ERROR', message: 'Application update failed.' });
    }

    const io = getSocketServer();
    if (io) {
      io.to(`user:${updated.expert_id}`).emit('notification', {
        type: 'application_status',
        title: 'Application Update',
        message: `Your application has been ${updated.status}`,
        jobId: job.id,
      });
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
    if (app.status !== 'accepted') {
      throw new HttpError({
        statusCode: 400,
        code: 'APPLICATION_NOT_ACCEPTED',
        message: 'Milestones can only be created for accepted applications.',
      });
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
    if (!['pending', 'accepted'].includes(app.status)) {
      throw new HttpError({
        statusCode: 400,
        code: 'APPLICATION_CHAT_NOT_ALLOWED',
        message: 'Application chat is available only for pending or accepted applications.',
      });
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
    if (!['pending', 'accepted'].includes(app.status)) {
      throw new HttpError({
        statusCode: 400,
        code: 'APPLICATION_CHAT_NOT_ALLOWED',
        message: 'Application chat is available only for pending or accepted applications.',
      });
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

  private async findApplicationForUpdate(
    client: PoolClient,
    applicationId: string,
  ): Promise<JobApplicationRow | null> {
    const { rows } = await client.query<JobApplicationRow>(
      `SELECT * FROM job_applications WHERE id = $1 FOR UPDATE`,
      [applicationId],
    );
    return rows[0] ?? null;
  }

  private async findJobForUpdate(client: PoolClient, jobId: string): Promise<JobRow | null> {
    const { rows } = await client.query<JobRow>(
      `SELECT * FROM jobs WHERE id = $1 FOR UPDATE`,
      [jobId],
    );
    return rows[0] ?? null;
  }

  private async listApplicationsByJobForUpdate(
    client: PoolClient,
    jobId: string,
  ): Promise<JobApplicationRow[]> {
    const { rows } = await client.query<JobApplicationRow>(
      `SELECT * FROM job_applications WHERE job_id = $1 FOR UPDATE`,
      [jobId],
    );
    return rows;
  }

  private async hasApplicationWorkStarted(client: PoolClient, applicationId: string): Promise<boolean> {
    const { rows } = await client.query<{ started: boolean }>(
      `SELECT EXISTS (
          SELECT 1
          FROM job_milestones
          WHERE job_application_id = $1
        ) AS started`,
      [applicationId],
    );
    return rows[0]?.started === true;
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
