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
import type { PoolClient } from 'pg';

import { getPool } from '../../db/pool.js';
import { getSocketServer } from '../../lib/socket-instance.js';
import { HttpError } from '../../utils/http-error.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { PlansService } from '../plans/plans.service.js';
import { ProfilesService } from '../profiles/profiles.service.js';
import { ReservationsRepository } from '../reservations/reservations.repository.js';
import { ReservationsService } from '../reservations/reservations.service.js';
import { SettingsService } from '../settings/settings.service.js';
import { WalletRepository } from '../wallet/wallet.repository.js';

import { JobsRepository } from './jobs.repository.js';
import type { JobRow, JobApplicationRow, JobMilestoneRow, JobSubmissionRow, JobApplicationMessageRow } from './jobs.repository.js';

const toNumber = (value: string | number | null | undefined): number => {
  if (value == null) return 0;
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const mapInterviewSlot = (row: {
  id: string;
  provider_id: string;
  purpose: string;
  job_id: string | null;
  start_at: string;
  end_at: string;
  status: string;
  supports_online: boolean;
  supports_offline: boolean;
  created_at: string;
  updated_at: string;
}): ReservationSlot => ({
  id: row.id,
  providerId: row.provider_id,
  purpose: row.purpose as ReservationSlot['purpose'],
  jobId: row.job_id,
  startAt: row.start_at,
  endAt: row.end_at,
  status: row.status as ReservationSlot['status'],
  supportsOnline: row.supports_online,
  supportsOffline: row.supports_offline,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

export class JobsService {
  constructor(
    private readonly repo: JobsRepository = new JobsRepository(),
    private readonly notificationsService: NotificationsService = new NotificationsService(),
    private readonly reservationsRepo: ReservationsRepository = new ReservationsRepository(),
    private readonly reservationsService: ReservationsService = new ReservationsService(),
    private readonly walletRepo: WalletRepository = new WalletRepository(),
    private readonly settingsService: SettingsService = new SettingsService(),
    private readonly profilesService: ProfilesService = new ProfilesService(),
    private readonly plansService: PlansService = new PlansService(),
  ) {}

  async createJob(businessId: string, input: CreateJobDto): Promise<Job> {
    const appStatus = await this.settingsService.getAppStatus();
    if (appStatus.featurePlansEnabled) {
      const limits = await this.plansService.getEffectivePlanLimits(businessId);
      if (limits.maxJobs != null) {
        const count = await this.repo.countJobsByBusiness(businessId);
        if (count >= limits.maxJobs) {
          throw new HttpError({
            statusCode: 403,
            code: 'PLAN_LIMIT_REACHED',
            message: `Your plan allows up to ${limits.maxJobs} jobs. Upgrade to post more.`,
          });
        }
      }
    }
    const createInput = {
      title: input.title,
      description: input.description,
      applicationFeeAmount: input.applicationFeeAmount,
      interviewEnabled: input.interviewEnabled ?? false,
      ...(input.requirements !== undefined ? { requirements: input.requirements } : {}),
      ...(input.salaryRange !== undefined ? { salaryRange: input.salaryRange } : {}),
      ...(input.interviewInstructions !== undefined
        ? { interviewInstructions: input.interviewInstructions }
        : {}),
    };
    const row = await this.repo.createJob(businessId, createInput);
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
    if (input.submissionType === 'cv_upload' && !input.cvFileUrl?.trim()) {
      throw new HttpError({
        statusCode: 400,
        code: 'CV_REQUIRED',
        message: 'CV file URL is required for CV submissions.',
      });
    }

    const profileSnapshot =
      input.submissionType === 'profile_snapshot'
        ? await this.profilesService.getExpertProfile(expertId)
        : null;
    const applicationFeeAmount = toNumber(job.application_fee_amount);
    const settings = await this.settingsService.getAppStatus();
    const applicationCommissionAmount = Math.min(
      applicationFeeAmount,
      Math.max(
        applicationFeeAmount * (settings.commissionPercent / 100),
        settings.commissionMinEgp,
      ),
    );
    const businessPayoutAmount = Math.max(0, applicationFeeAmount - applicationCommissionAmount);

    let expertWallet = null;
    if (applicationFeeAmount > 0) {
      expertWallet = await this.walletRepo.findByUserId(expertId);
      if (!expertWallet) {
        throw new HttpError({
          statusCode: 402,
          code: 'INSUFFICIENT_BALANCE',
          message: 'Expert wallet is required to submit this application.',
        });
      }
      await this.walletRepo.createForUser(job.business_id);
    }

    const pool = getPool();
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const applicationInput = {
        jobId,
        expertId,
        submissionType: input.submissionType,
        applicationFeeAmount,
        applicationCommissionAmount,
        businessPayoutAmount,
        ...(input.coverLetter !== undefined ? { coverLetter: input.coverLetter } : {}),
        ...(profileSnapshot != null ? { profileSnapshot } : {}),
        ...(input.cvFileUrl?.trim() ? { cvFileUrl: input.cvFileUrl.trim() } : {}),
      };
      const app = await this.repo.applyForJob(
        applicationInput,
        client,
      );

      if (applicationFeeAmount > 0) {
        const businessWallet = await this.walletRepo.findByUserId(job.business_id);
        if (!businessWallet || !expertWallet) {
          throw new HttpError({
            statusCode: 402,
            code: 'INSUFFICIENT_BALANCE',
            message: 'Wallets are not configured for this application payment.',
          });
        }

        const platformWalletId = await this.walletRepo.getOrCreateCommissionWallet(
          client,
          settings.commissionReceiverId,
        );

        await this.walletRepo.debitWalletInTransaction(
          client,
          expertWallet.id,
          expertId,
          applicationFeeAmount,
          'Paid hiring application submission',
          'job_application',
          app.id,
        );

        if (businessPayoutAmount > 0) {
          await this.walletRepo.creditWithTypeInTransaction(
            client,
            businessWallet.id,
            job.business_id,
            businessPayoutAmount,
            'payment',
            'Hiring application payout',
            'job_application',
            app.id,
          );
        }

        if (applicationCommissionAmount > 0) {
          await this.walletRepo.creditWithTypeInTransaction(
            client,
            platformWalletId,
            settings.commissionReceiverId,
            applicationCommissionAmount,
            'commission',
            'Hiring application commission',
            'job_application',
            app.id,
          );
        }
      }

      await client.query('COMMIT');
      await this.notificationsService.createForUser(job.business_id, {
        type: 'job_application',
        title: 'New hiring application',
        message: 'A new expert submitted a paid application to your hiring post.',
        payload: { jobId: job.id },
      });
      return this.toApplication(app);
    } catch (err: unknown) {
      await client.query('ROLLBACK');
      const pgErr = err as { code?: string };
      if (pgErr.code === '23505') {
        throw new HttpError({
          statusCode: 409,
          code: 'DUPLICATE_APPLICATION',
          message: 'You already applied for this job.',
        });
      }
      if (err instanceof Error && err.message === 'INSUFFICIENT_BALANCE') {
        throw new HttpError({
          statusCode: 402,
          code: 'INSUFFICIENT_BALANCE',
          message: 'Insufficient balance to submit this application.',
        });
      }
      throw err;
    } finally {
      client.release();
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

  async updateApplicationStatus(
    applicationId: string,
    businessId: string,
    status: JobApplication['status'],
  ): Promise<JobApplication> {
    const allowedStatus = new Set<JobApplication['status']>([
      'pending',
      'reviewed',
      'interview_invited',
      'interview_booked',
      'interview_completed',
      'accepted',
      'rejected',
    ]);
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
             AND status IN ('pending', 'reviewed', 'interview_invited', 'interview_booked', 'interview_completed', 'accepted')`,
          [app.job_id, applicationId],
        );
      } else {
        if (app.status === 'accepted') {
          const started = await this.hasApplicationWorkStarted(client, app.id);
          if (started) {
            throw new HttpError({
              statusCode: 409,
              code: 'APPLICATION_REPLACEMENT_BLOCKED',
              message: 'Cannot change accepted application after work has started.',
            });
          }
        }
        if (status === 'interview_invited') {
          if (!job.interview_enabled) {
            throw new HttpError({
              statusCode: 400,
              code: 'INTERVIEWS_DISABLED',
              message: 'Interviews are not enabled for this hiring post.',
            });
          }
          await this.repo.updateApplication(
            applicationId,
            { status, interviewInvitationSentAt: new Date() },
            client,
          );
        } else {
          await this.repo.updateApplication(applicationId, { status }, client);
        }
      }

      updated = await this.repo.getApplicationById(applicationId);
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

    await this.notificationsService.createForUser(updated.expert_id, {
      type: 'application_status',
      title: 'Application Update',
      message: `Your application has been ${updated.status}`,
      payload: { jobId: job.id },
    });

    return this.toApplication(updated);
  }

  async createInterviewSlot(
    jobId: string,
    businessId: string,
    input: CreateJobInterviewSlotDto,
  ): Promise<ReservationSlot> {
    const job = await this.repo.getJobById(jobId);
    if (!job || job.business_id !== businessId) {
      throw new HttpError({ statusCode: 403, code: 'FORBIDDEN', message: 'You do not own this job.' });
    }
    if (!job.interview_enabled) {
      throw new HttpError({
        statusCode: 400,
        code: 'INTERVIEWS_DISABLED',
        message: 'Interviews are not enabled for this hiring post.',
      });
    }

    try {
      const slot = await this.reservationsRepo.createSlot(businessId, {
        startAt: new Date(input.startAt),
        endAt: new Date(input.endAt),
        supportsOnline: input.supportsOnline ?? true,
        supportsOffline: input.supportsOffline ?? true,
        purpose: 'job_interview',
        jobId,
      });
      return mapInterviewSlot(slot);
    } catch (error) {
      const pgError = error as { code?: string; constraint?: string };
      if (pgError?.code === '23P01' || pgError?.constraint === 'reservation_slots_no_overlap_active') {
        throw new HttpError({
          statusCode: 409,
          code: 'SLOT_OVERLAP',
          message: 'This interview slot overlaps with another active slot.',
        });
      }
      throw error;
    }
  }

  async listBusinessInterviewSlots(
    jobId: string,
    businessId: string,
    range: { from: Date; to: Date },
  ): Promise<{ items: ReservationSlot[] }> {
    const job = await this.repo.getJobById(jobId);
    if (!job || job.business_id !== businessId) {
      throw new HttpError({ statusCode: 403, code: 'FORBIDDEN', message: 'You do not own this job.' });
    }
    const rows = await this.reservationsRepo.listSlots(businessId, range.from, range.to, false, {
      purpose: 'job_interview',
      jobId,
    });
    return { items: rows.map(mapInterviewSlot) };
  }

  async updateInterviewSlot(
    slotId: string,
    businessId: string,
    input: UpdateJobInterviewSlotDto,
  ): Promise<ReservationSlot> {
    const slot = await this.reservationsRepo.findSlotById(slotId);
    if (!slot || slot.provider_id !== businessId || slot.purpose !== 'job_interview') {
      throw new HttpError({
        statusCode: 404,
        code: 'SLOT_NOT_FOUND',
        message: 'Interview slot not found.',
      });
    }

    try {
      const updated = await this.reservationsRepo.updateSlot(slotId, {
        ...(input.startAt !== undefined ? { startAt: new Date(input.startAt) } : {}),
        ...(input.endAt !== undefined ? { endAt: new Date(input.endAt) } : {}),
        ...(input.status !== undefined ? { status: input.status } : {}),
        ...(input.supportsOnline !== undefined ? { supportsOnline: input.supportsOnline } : {}),
        ...(input.supportsOffline !== undefined ? { supportsOffline: input.supportsOffline } : {}),
      });
      if (!updated) {
        throw new HttpError({
          statusCode: 400,
          code: 'SLOT_UPDATE_FAILED',
          message: 'Interview slot could not be updated.',
        });
      }
      return mapInterviewSlot(updated);
    } catch (error) {
      const pgError = error as { code?: string; constraint?: string };
      if (pgError?.code === '23P01' || pgError?.constraint === 'reservation_slots_no_overlap_active') {
        throw new HttpError({
          statusCode: 409,
          code: 'SLOT_OVERLAP',
          message: 'This interview slot overlaps with another active slot.',
        });
      }
      throw error;
    }
  }

  async deleteInterviewSlot(slotId: string, businessId: string): Promise<{ deleted: boolean }> {
    const slot = await this.reservationsRepo.findSlotById(slotId);
    if (!slot || slot.provider_id !== businessId || slot.purpose !== 'job_interview') {
      throw new HttpError({
        statusCode: 404,
        code: 'SLOT_NOT_FOUND',
        message: 'Interview slot not found.',
      });
    }
    return { deleted: await this.reservationsRepo.deleteSlot(slotId) };
  }

  async listApplicationInterviewSlots(
    applicationId: string,
    userId: string,
  ): Promise<{ items: ReservationSlot[] }> {
    const app = await this.repo.getApplicationById(applicationId);
    if (!app) {
      throw new HttpError({ statusCode: 404, code: 'NOT_FOUND', message: 'Application not found' });
    }
    const job = await this.repo.getJobById(app.job_id);
    if (!job) {
      throw new HttpError({ statusCode: 404, code: 'NOT_FOUND', message: 'Job not found' });
    }
    const isBusiness = job.business_id === userId;
    const isExpert = app.expert_id === userId;
    if (!isBusiness && !isExpert) {
      throw new HttpError({ statusCode: 403, code: 'FORBIDDEN', message: 'You are not authorized.' });
    }
    if (isExpert && !['interview_invited', 'interview_booked', 'interview_completed', 'accepted'].includes(app.status)) {
      throw new HttpError({
        statusCode: 400,
        code: 'INTERVIEW_NOT_AVAILABLE',
        message: 'Interview slots are not available for this application yet.',
      });
    }

    const from = new Date();
    const to = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000);
    const rows = await this.reservationsRepo.listSlots(job.business_id, from, to, true, {
      purpose: 'job_interview',
      jobId: job.id,
    });
    return { items: rows.map(mapInterviewSlot) };
  }

  async bookInterview(
    applicationId: string,
    expertId: string,
    input: BookJobInterviewDto,
    idempotencyKey?: string,
  ): Promise<Reservation> {
    const app = await this.repo.getApplicationById(applicationId);
    if (!app || app.expert_id !== expertId) {
      throw new HttpError({
        statusCode: 403,
        code: 'FORBIDDEN',
        message: 'You are not the expert for this application',
      });
    }
    if (app.status !== 'interview_invited') {
      throw new HttpError({
        statusCode: 400,
        code: 'INTERVIEW_NOT_AVAILABLE',
        message: 'This application is not ready for interview booking.',
      });
    }
    const job = await this.repo.getJobById(app.job_id);
    if (!job || !job.interview_enabled) {
      throw new HttpError({
        statusCode: 400,
        code: 'INTERVIEWS_DISABLED',
        message: 'Interviews are not enabled for this hiring post.',
      });
    }

    const reservation = await this.reservationsService.createJobInterviewReservation({
      expertId,
      businessId: job.business_id,
      jobId: job.id,
      jobApplicationId: app.id,
      slotId: input.slotId,
      mode: input.mode,
      ...(idempotencyKey ? { idempotencyKey } : {}),
    });

    await this.repo.updateApplication(app.id, {
      interviewReservationId: reservation.id,
      status: 'interview_booked',
    });
    await this.notificationsService.createForUser(job.business_id, {
      type: 'job_interview_booked',
      title: 'Interview booked',
      message: 'An invited expert booked an interview slot.',
      payload: { jobId: job.id, applicationId: app.id, reservationId: reservation.id },
    });
    return reservation;
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

    await this.notificationsService.createForUser(job.business_id, {
      type: 'milestone_submitted',
      title: 'Milestone Submitted',
      message: `Work submitted for milestone: ${milestone.title}`,
      payload: { applicationId: app.id },
    });

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

    await this.notificationsService.createForUser(app.expert_id, {
      type: 'milestone_reviewed',
      title: 'Milestone Reviewed',
      message: `Your milestone "${milestone.title}" was ${status}`,
      payload: { applicationId: app.id },
    });

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
    if (!['pending', 'reviewed', 'interview_invited', 'interview_booked', 'interview_completed', 'accepted'].includes(app.status)) {
      throw new HttpError({
        statusCode: 400,
        code: 'APPLICATION_CHAT_NOT_ALLOWED',
        message: 'Application chat is available only for active application stages.',
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
    if (!['pending', 'reviewed', 'interview_invited', 'interview_booked', 'interview_completed', 'accepted'].includes(app.status)) {
      throw new HttpError({
        statusCode: 400,
        code: 'APPLICATION_CHAT_NOT_ALLOWED',
        message: 'Application chat is available only for active application stages.',
      });
    }

    const msg = await this.repo.createApplicationMessage(applicationId, userId, content);
    const msgDto = this.toApplicationMessage(msg);

    const io = getSocketServer();
    if (io) {
      io.to(`application:${applicationId}`).emit('new_application_message', msgDto);
    }

    const targetUserId = userId === app.expert_id ? job.business_id : app.expert_id;
    await this.notificationsService.createForUser(targetUserId, {
      type: 'new_message',
      title: 'New Message',
      message: 'New message on job application',
      payload: { applicationId },
    });

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
      applicationFeeAmount: toNumber(row.application_fee_amount),
      interviewEnabled: row.interview_enabled,
      interviewInstructions: row.interview_instructions,
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
      jobTitle: row.job_title,
      businessName: row.business_name,
      coverLetter: row.cover_letter,
      submissionType: row.submission_type as JobApplication['submissionType'],
      profileSnapshot: row.profile_snapshot ?? null,
      cvFileUrl: row.cv_file_url,
      applicationFeeAmount: toNumber(row.application_fee_amount),
      applicationCommissionAmount: toNumber(row.application_commission_amount),
      businessPayoutAmount: toNumber(row.business_payout_amount),
      interviewInvitationSentAt: row.interview_invitation_sent_at,
      interviewReservationId: row.interview_reservation_id,
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
