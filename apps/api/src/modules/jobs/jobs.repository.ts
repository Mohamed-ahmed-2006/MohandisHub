import type { Pool } from 'pg';

import { getPool } from '../../db/pool.js';

export type JobRow = {
  id: string;
  business_id: string;
  business_name?: string;
  title: string;
  description: string;
  requirements: string | null;
  salary_range: string | null;
  status: string;
  created_at: string;
  updated_at: string;
};

export type JobApplicationRow = {
  id: string;
  job_id: string;
  expert_id: string;
  expert_name?: string;
  cover_letter: string | null;
  status: string;
  created_at: string;
  updated_at: string;
};

export type JobApplicationMessageRow = {
  id: string;
  job_application_id: string;
  sender_id: string;
  sender_name?: string;
  content: string;
  created_at: string;
};
export type JobMilestoneRow = {
  id: string;
  job_application_id: string;
  title: string;
  amount: string;
  status: string;
  created_at: string;
  updated_at: string;
};

export type JobSubmissionRow = {
  id: string;
  milestone_id: string;
  submission_notes: string | null;
  attachments: unknown;
  created_at: string;
};

export class JobsRepository {
  private get db(): Pool {
    return getPool();
  }

  async createJob(businessId: string, title: string, description: string, requirements?: string, salaryRange?: string): Promise<JobRow> {
    const { rows } = await this.db.query<JobRow>(
      `INSERT INTO jobs (business_id, title, description, requirements, salary_range)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [businessId, title, description, requirements ?? null, salaryRange ?? null]
    );
    return rows[0]!;
  }

  async listOpenJobs(page: number, limit: number): Promise<{ rows: JobRow[]; total: number }> {
    const offset = (page - 1) * limit;
    const countResult = await this.db.query<{ count: string }>(`SELECT COUNT(*)::text as count FROM jobs WHERE status = 'open'`);
    const total = parseInt(countResult.rows[0]!.count, 10);

    const { rows } = await this.db.query<JobRow>(
      `SELECT j.*, u.display_name as business_name
       FROM jobs j
       JOIN users u ON j.business_id = u.id
       WHERE j.status = 'open'
       ORDER BY j.created_at DESC
       LIMIT $1::int OFFSET $2::int`,
      [limit, offset]
    );

    return { rows, total };
  }

  async listBusinessJobs(businessId: string, page: number, limit: number): Promise<{ rows: JobRow[]; total: number }> {
    const offset = (page - 1) * limit;
    const countResult = await this.db.query<{ count: string }>(`SELECT COUNT(*)::text as count FROM jobs WHERE business_id = $1`, [businessId]);
    const total = parseInt(countResult.rows[0]!.count, 10);

    const { rows } = await this.db.query<JobRow>(
      `SELECT * FROM jobs WHERE business_id = $1 ORDER BY created_at DESC LIMIT $2::int OFFSET $3::int`,
      [businessId, limit, offset]
    );

    return { rows, total };
  }

  async getJobById(jobId: string): Promise<JobRow | null> {
    const { rows } = await this.db.query<JobRow>(`SELECT * FROM jobs WHERE id = $1`, [jobId]);
    return rows[0] ?? null;
  }

  async applyForJob(jobId: string, expertId: string, coverLetter?: string): Promise<JobApplicationRow> {
    const { rows } = await this.db.query<JobApplicationRow>(
      `INSERT INTO job_applications (job_id, expert_id, cover_letter)
       VALUES ($1, $2, $3)
       RETURNING *`,
      [jobId, expertId, coverLetter ?? null]
    );
    return rows[0]!;
  }

  async listJobApplications(jobId: string): Promise<JobApplicationRow[]> {
    const { rows } = await this.db.query<JobApplicationRow>(
      `SELECT a.*, u.display_name as expert_name
       FROM job_applications a
       JOIN users u ON a.expert_id = u.id
       WHERE a.job_id = $1
       ORDER BY a.created_at DESC`,
      [jobId]
    );
    return rows;
  }

  async listExpertApplications(expertId: string): Promise<JobApplicationRow[]> {
    const { rows } = await this.db.query<JobApplicationRow>(
      `SELECT a.*, u.display_name as expert_name
       FROM job_applications a
       JOIN jobs j ON a.job_id = j.id
       JOIN users u ON j.business_id = u.id
       WHERE a.expert_id = $1
       ORDER BY a.created_at DESC`,
      [expertId]
    );
    return rows;
  }

  async updateApplicationStatus(applicationId: string, status: string): Promise<JobApplicationRow> {
    const { rows } = await this.db.query<JobApplicationRow>(
      `UPDATE job_applications SET status = $1, updated_at = now() WHERE id = $2 RETURNING *`,
      [status, applicationId]
    );
    return rows[0]!;
  }

  async updateJobStatus(jobId: string, businessId: string, status: string): Promise<JobRow> {
    const { rows } = await this.db.query<JobRow>(
      `UPDATE jobs SET status = $1, updated_at = now() WHERE id = $2 AND business_id = $3 RETURNING *`,
      [status, jobId, businessId]
    );
    return rows[0]!;
  }

  async getApplicationById(applicationId: string): Promise<JobApplicationRow | null> {
    const { rows } = await this.db.query<JobApplicationRow>(`SELECT * FROM job_applications WHERE id = $1`, [applicationId]);
    return rows[0] ?? null;
  }

  async createMilestone(jobApplicationId: string, title: string, amount: number): Promise<JobMilestoneRow> {
    const { rows } = await this.db.query<JobMilestoneRow>(
      `INSERT INTO job_milestones (job_application_id, title, amount)
       VALUES ($1, $2, $3)
       RETURNING *`,
      [jobApplicationId, title, amount]
    );
    return rows[0]!;
  }

  async listMilestones(jobApplicationId: string): Promise<JobMilestoneRow[]> {
    const { rows } = await this.db.query<JobMilestoneRow>(
      `SELECT * FROM job_milestones WHERE job_application_id = $1 ORDER BY created_at ASC`,
      [jobApplicationId]
    );
    return rows;
  }

  async updateMilestoneStatus(milestoneId: string, status: string): Promise<JobMilestoneRow> {
    const { rows } = await this.db.query<JobMilestoneRow>(
      `UPDATE job_milestones SET status = $1, updated_at = now() WHERE id = $2 RETURNING *`,
      [status, milestoneId]
    );
    return rows[0]!;
  }

  async createSubmission(
    milestoneId: string,
    notes?: string,
    attachments?: unknown,
  ): Promise<JobSubmissionRow> {
    const { rows } = await this.db.query<JobSubmissionRow>(
      `INSERT INTO job_submissions (milestone_id, submission_notes, attachments)
       VALUES ($1, $2, $3)
       RETURNING *`,
      [milestoneId, notes ?? null, attachments ?? '[]']
    );
    return rows[0]!;
  }

  async getMilestoneById(milestoneId: string): Promise<JobMilestoneRow | null> {
    const { rows } = await this.db.query<JobMilestoneRow>(
      `SELECT * FROM job_milestones WHERE id = $1`,
      [milestoneId]
    );
    return rows[0] ?? null;
  }

  async createApplicationMessage(applicationId: string, senderId: string, content: string): Promise<JobApplicationMessageRow> {
    const { rows } = await this.db.query<JobApplicationMessageRow>(
      `INSERT INTO job_application_messages (job_application_id, sender_id, content)
       VALUES ($1, $2, $3)
       RETURNING *`,
      [applicationId, senderId, content]
    );
    return rows[0]!;
  }

  async listApplicationMessages(applicationId: string): Promise<JobApplicationMessageRow[]> {
    const { rows } = await this.db.query<JobApplicationMessageRow>(
      `SELECT m.*, u.display_name as sender_name
       FROM job_application_messages m
       JOIN users u ON m.sender_id = u.id
       WHERE m.job_application_id = $1
       ORDER BY m.created_at ASC`,
      [applicationId]
    );
    return rows;
  }
}
