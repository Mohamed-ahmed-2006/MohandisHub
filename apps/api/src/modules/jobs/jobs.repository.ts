import type { Pool, PoolClient } from 'pg';

import { getPool } from '../../db/pool.js';

export type JobRow = {
  id: string;
  business_id: string;
  business_name?: string;
  title: string;
  description: string;
  requirements: string | null;
  salary_range: string | null;
  application_fee_amount: string;
  interview_enabled: boolean;
  interview_instructions: string | null;
  status: string;
  created_at: string;
  updated_at: string;
};

export type JobApplicationRow = {
  id: string;
  job_id: string;
  expert_id: string;
  expert_name?: string;
  job_title?: string;
  business_name?: string;
  cover_letter: string | null;
  submission_type: string;
  profile_snapshot: Record<string, unknown> | null;
  cv_file_url: string | null;
  application_fee_amount: string;
  application_commission_amount: string;
  business_payout_amount: string;
  interview_invitation_sent_at: string | null;
  interview_reservation_id: string | null;
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

  async createJob(
    businessId: string,
    input: {
      title: string;
      description: string;
      requirements?: string;
      salaryRange?: string;
      applicationFeeAmount: number;
      interviewEnabled: boolean;
      interviewInstructions?: string;
    },
  ): Promise<JobRow> {
    const { rows } = await this.db.query<JobRow>(
      `INSERT INTO jobs (
         business_id,
         title,
         description,
         requirements,
         salary_range,
         application_fee_amount,
         interview_enabled,
         interview_instructions
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING *`,
      [
        businessId,
        input.title,
        input.description,
        input.requirements ?? null,
        input.salaryRange ?? null,
        input.applicationFeeAmount,
        input.interviewEnabled,
        input.interviewInstructions ?? null,
      ],
    );
    return rows[0]!;
  }

  async listOpenJobs(page: number, limit: number): Promise<{ rows: JobRow[]; total: number }> {
    const offset = (page - 1) * limit;
    const countResult = await this.db.query<{ count: string }>(
      `SELECT COUNT(*)::text as count FROM jobs WHERE status = 'open'`,
    );
    const total = parseInt(countResult.rows[0]!.count, 10);

    const { rows } = await this.db.query<JobRow>(
      `SELECT j.*, u.display_name as business_name
       FROM jobs j
       JOIN users u ON j.business_id = u.id
       WHERE j.status = 'open'
       ORDER BY j.created_at DESC
       LIMIT $1::int OFFSET $2::int`,
      [limit, offset],
    );

    return { rows, total };
  }

  async countJobsByBusiness(businessId: string): Promise<number> {
    const { rows } = await this.db.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM jobs WHERE business_id = $1`,
      [businessId],
    );
    return rows.length > 0 ? parseInt(rows[0]!.count, 10) : 0;
  }

  async listBusinessJobs(
    businessId: string,
    page: number,
    limit: number,
  ): Promise<{ rows: JobRow[]; total: number }> {
    const offset = (page - 1) * limit;
    const total = await this.countJobsByBusiness(businessId);

    const { rows } = await this.db.query<JobRow>(
      `SELECT j.*, u.display_name as business_name
       FROM jobs j
       JOIN users u ON j.business_id = u.id
       WHERE j.business_id = $1
       ORDER BY j.created_at DESC
       LIMIT $2::int OFFSET $3::int`,
      [businessId, limit, offset],
    );

    return { rows, total };
  }

  async getJobById(jobId: string): Promise<JobRow | null> {
    const { rows } = await this.db.query<JobRow>(
      `SELECT j.*, u.display_name as business_name
       FROM jobs j
       JOIN users u ON j.business_id = u.id
       WHERE j.id = $1`,
      [jobId],
    );
    return rows[0] ?? null;
  }

  async applyForJob(
    input: {
      jobId: string;
      expertId: string;
      coverLetter?: string;
      submissionType: string;
      profileSnapshot?: unknown;
      cvFileUrl?: string;
      applicationFeeAmount: number;
      applicationCommissionAmount: number;
      businessPayoutAmount: number;
    },
    client?: PoolClient,
  ): Promise<JobApplicationRow> {
    const db = client ?? this.db;
    const { rows } = await db.query<JobApplicationRow>(
      `INSERT INTO job_applications (
         job_id,
         expert_id,
         cover_letter,
         submission_type,
         profile_snapshot,
         cv_file_url,
         application_fee_amount,
         application_commission_amount,
         business_payout_amount
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING *`,
      [
        input.jobId,
        input.expertId,
        input.coverLetter ?? null,
        input.submissionType,
        input.profileSnapshot ?? null,
        input.cvFileUrl ?? null,
        input.applicationFeeAmount,
        input.applicationCommissionAmount,
        input.businessPayoutAmount,
      ],
    );
    return rows[0]!;
  }

  async listJobApplications(jobId: string): Promise<JobApplicationRow[]> {
    const { rows } = await this.db.query<JobApplicationRow>(
      `SELECT a.*,
              u.display_name as expert_name,
              j.title as job_title,
              bu.display_name as business_name
       FROM job_applications a
       JOIN users u ON a.expert_id = u.id
       JOIN jobs j ON a.job_id = j.id
       JOIN users bu ON j.business_id = bu.id
       WHERE a.job_id = $1
       ORDER BY a.created_at DESC`,
      [jobId],
    );
    return rows;
  }

  async listExpertApplications(expertId: string): Promise<JobApplicationRow[]> {
    const { rows } = await this.db.query<JobApplicationRow>(
      `SELECT a.*,
              eu.display_name as expert_name,
              j.title as job_title,
              bu.display_name as business_name
       FROM job_applications a
       JOIN jobs j ON a.job_id = j.id
       JOIN users eu ON a.expert_id = eu.id
       JOIN users bu ON j.business_id = bu.id
       WHERE a.expert_id = $1
       ORDER BY a.created_at DESC`,
      [expertId],
    );
    return rows;
  }

  async updateApplication(
    applicationId: string,
    updates: Partial<{
      status: string;
      interviewInvitationSentAt: Date | null;
      interviewReservationId: string | null;
    }>,
    client?: PoolClient,
  ): Promise<JobApplicationRow | null> {
    const db = client ?? this.db;
    const entries = Object.entries(updates).filter(([, value]) => value !== undefined);
    if (entries.length === 0) return this.getApplicationById(applicationId);

    const keyMap: Record<string, string> = {
      status: 'status',
      interviewInvitationSentAt: 'interview_invitation_sent_at',
      interviewReservationId: 'interview_reservation_id',
    };

    const values: unknown[] = [];
    const setClauses = ['updated_at = now()'];
    let idx = 1;
    for (const [key, value] of entries) {
      setClauses.push(`${keyMap[key]} = $${idx++}`);
      values.push(value);
    }
    values.push(applicationId);

    const { rows } = await db.query<JobApplicationRow>(
      `UPDATE job_applications
       SET ${setClauses.join(', ')}
       WHERE id = $${idx}
       RETURNING *`,
      values,
    );
    return rows[0] ?? null;
  }

  async updateJobStatus(jobId: string, businessId: string, status: string): Promise<JobRow> {
    const { rows } = await this.db.query<JobRow>(
      `UPDATE jobs
       SET status = $1, updated_at = now()
       WHERE id = $2 AND business_id = $3
       RETURNING *`,
      [status, jobId, businessId],
    );
    return rows[0]!;
  }

  async getApplicationById(applicationId: string): Promise<JobApplicationRow | null> {
    const { rows } = await this.db.query<JobApplicationRow>(
      `SELECT a.*,
              eu.display_name as expert_name,
              j.title as job_title,
              bu.display_name as business_name
       FROM job_applications a
       JOIN jobs j ON a.job_id = j.id
       JOIN users eu ON a.expert_id = eu.id
       JOIN users bu ON j.business_id = bu.id
       WHERE a.id = $1`,
      [applicationId],
    );
    return rows[0] ?? null;
  }

  async createMilestone(
    jobApplicationId: string,
    title: string,
    amount: number,
  ): Promise<JobMilestoneRow> {
    const { rows } = await this.db.query<JobMilestoneRow>(
      `INSERT INTO job_milestones (job_application_id, title, amount)
       VALUES ($1, $2, $3)
       RETURNING *`,
      [jobApplicationId, title, amount],
    );
    return rows[0]!;
  }

  async listMilestones(jobApplicationId: string): Promise<JobMilestoneRow[]> {
    const { rows } = await this.db.query<JobMilestoneRow>(
      `SELECT * FROM job_milestones WHERE job_application_id = $1 ORDER BY created_at ASC`,
      [jobApplicationId],
    );
    return rows;
  }

  async updateMilestoneStatus(milestoneId: string, status: string): Promise<JobMilestoneRow> {
    const { rows } = await this.db.query<JobMilestoneRow>(
      `UPDATE job_milestones SET status = $1, updated_at = now() WHERE id = $2 RETURNING *`,
      [status, milestoneId],
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
      [milestoneId, notes ?? null, attachments ?? '[]'],
    );
    return rows[0]!;
  }

  async getMilestoneById(milestoneId: string): Promise<JobMilestoneRow | null> {
    const { rows } = await this.db.query<JobMilestoneRow>(
      `SELECT * FROM job_milestones WHERE id = $1`,
      [milestoneId],
    );
    return rows[0] ?? null;
  }

  async createApplicationMessage(
    applicationId: string,
    senderId: string,
    content: string,
  ): Promise<JobApplicationMessageRow> {
    const { rows } = await this.db.query<JobApplicationMessageRow>(
      `INSERT INTO job_application_messages (job_application_id, sender_id, content)
       VALUES ($1, $2, $3)
       RETURNING *`,
      [applicationId, senderId, content],
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
      [applicationId],
    );
    return rows;
  }
}
