import type { Request, Response, NextFunction } from 'express';
import { z } from 'zod';

import { HttpError } from '../../utils/http-error.js';

import { JobsService } from './jobs.service.js';

const createJobSchema = z.object({
  title: z.string().min(3).max(300),
  description: z.string().min(10),
  requirements: z.string().optional(),
  salaryRange: z.string().optional(),
  applicationFeeAmount: z.number().min(0),
  interviewEnabled: z.boolean().optional(),
  interviewInstructions: z.string().max(4000).optional(),
});

const applyJobSchema = z
  .object({
    coverLetter: z.string().optional(),
    submissionType: z.enum(['profile_snapshot', 'cv_upload']),
    cvFileUrl: z.string().min(1).optional(), // URL or /api/upload/private/:id
  })
  .superRefine((value, ctx) => {
    if (value.submissionType === 'cv_upload' && !value.cvFileUrl?.trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'cvFileUrl is required for CV uploads',
        path: ['cvFileUrl'],
      });
    }
  });

const createMilestoneSchema = z.object({
  title: z.string().min(3).max(300),
  amount: z.number().positive(),
});

const submitMilestoneSchema = z.object({
  submissionNotes: z.string().optional(),
  attachments: z.any().optional(),
});

const applicationMessageSchema = z.object({
  content: z.string().min(1),
});

const updateApplicationStatusSchema = z.object({
  status: z.enum([
    'pending',
    'reviewed',
    'interview_invited',
    'interview_booked',
    'interview_completed',
    'accepted',
    'rejected',
  ]),
});

const reviewMilestoneSchema = z.object({
  status: z.enum(['approved', 'rejected']),
});

const createInterviewSlotSchema = z
  .object({
    startAt: z.string().datetime(),
    endAt: z.string().datetime(),
    supportsOnline: z.boolean().optional(),
    supportsOffline: z.boolean().optional(),
  })
  .refine((value) => new Date(value.endAt) > new Date(value.startAt), {
    message: 'endAt must be after startAt',
  });

const updateInterviewSlotSchema = z.object({
  startAt: z.string().datetime().optional(),
  endAt: z.string().datetime().optional(),
  status: z.enum(['available', 'booked', 'blocked']).optional(),
  supportsOnline: z.boolean().optional(),
  supportsOffline: z.boolean().optional(),
});

const bookInterviewSchema = z.object({
  slotId: z.string().uuid(),
  mode: z.enum(['online', 'offline']),
});

function parseBody<T>(
  schema: {
    safeParse: (data: unknown) => {
      success: boolean;
      data?: T;
      error?: { flatten: () => { fieldErrors: unknown } };
    };
  },
  body: unknown,
): T {
  const result = schema.safeParse(body);
  if (!result.success) {
    throw new HttpError({
      statusCode: 400,
      code: 'VALIDATION_ERROR',
      message: 'Invalid input.',
      details: result.error!.flatten().fieldErrors,
    });
  }
  return result.data as T;
}

function requireIdempotencyKey(req: Request): string {
  const key = req.header('Idempotency-Key')?.trim();
  if (!key) {
    throw new HttpError({
      statusCode: 400,
      code: 'IDEMPOTENCY_KEY_REQUIRED',
      message: 'Idempotency-Key header is required.',
    });
  }
  return key;
}

class JobsController {
  constructor(private readonly service: JobsService = new JobsService()) {}

  listOpenJobs = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const page = Math.max(1, parseInt(req.query.page as string || '1', 10));
      const limit = Math.max(1, Math.min(50, parseInt(req.query.limit as string || '20', 10)));
      const result = await this.service.listOpenJobs(page, limit);
      res.json({ ok: true, data: result });
    } catch (err) {
      next(err);
    }
  };

  createJob = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = req.user!;
      const data = parseBody(createJobSchema, req.body);
      const job = await this.service.createJob(user.id, {
        title: data.title,
        description: data.description,
        applicationFeeAmount: data.applicationFeeAmount,
        ...(data.requirements !== undefined ? { requirements: data.requirements } : {}),
        ...(data.salaryRange !== undefined ? { salaryRange: data.salaryRange } : {}),
        ...(data.interviewEnabled !== undefined ? { interviewEnabled: data.interviewEnabled } : {}),
        ...(data.interviewInstructions !== undefined
          ? { interviewInstructions: data.interviewInstructions }
          : {}),
      });
      res.status(201).json({ ok: true, data: job });
    } catch (err) {
      next(err);
    }
  };

  listBusinessJobs = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = req.user!;
      const page = Math.max(1, parseInt(req.query.page as string || '1', 10));
      const limit = Math.max(1, Math.min(50, parseInt(req.query.limit as string || '20', 10)));
      const result = await this.service.listBusinessJobs(user.id, page, limit);
      res.json({ ok: true, data: result });
    } catch (err) {
      next(err);
    }
  };

  applyForJob = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = req.user!;
      const jobId = req.params.id!;
      const data = parseBody(applyJobSchema, req.body);
      const app = await this.service.applyForJob(jobId, user.id, data);
      res.status(201).json({ ok: true, data: app });
    } catch (err) {
      next(err);
    }
  };

  getJobApplications = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = req.user!;
      const jobId = req.params.id!;
      const apps = await this.service.getJobApplications(jobId, user.id);
      res.json({ ok: true, data: apps });
    } catch (err) {
      next(err);
    }
  };

  listExpertApplications = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = req.user!;
      const apps = await this.service.listExpertApplications(user.id);
      res.json({ ok: true, data: apps });
    } catch (err) {
      next(err);
    }
  };

  updateApplicationStatus = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = req.user!;
      const appId = req.params.appId!;
      const { status } = parseBody(updateApplicationStatusSchema, req.body);
      const app = await this.service.updateApplicationStatus(appId, user.id, status);
      res.json({ ok: true, data: app });
    } catch (err) {
      next(err);
    }
  };

  createInterviewSlot = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = req.user!;
      const jobId = req.params.id!;
      const data = parseBody(createInterviewSlotSchema, req.body);
      const slot = await this.service.createInterviewSlot(jobId, user.id, {
        startAt: data.startAt,
        endAt: data.endAt,
        ...(data.supportsOnline !== undefined ? { supportsOnline: data.supportsOnline } : {}),
        ...(data.supportsOffline !== undefined ? { supportsOffline: data.supportsOffline } : {}),
      });
      res.status(201).json({ ok: true, data: slot });
    } catch (err) {
      next(err);
    }
  };

  listBusinessInterviewSlots = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = req.user!;
      const jobId = req.params.id!;
      const fromRaw =
        (req.query.from as string | undefined) ?? new Date().toISOString();
      const toRaw =
        (req.query.to as string | undefined) ??
        new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString();
      const result = await this.service.listBusinessInterviewSlots(jobId, user.id, {
        from: new Date(fromRaw),
        to: new Date(toRaw),
      });
      res.json({ ok: true, data: result });
    } catch (err) {
      next(err);
    }
  };

  updateInterviewSlot = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = req.user!;
      const slotId = req.params.slotId!;
      const data = parseBody(updateInterviewSlotSchema, req.body);
      const slot = await this.service.updateInterviewSlot(slotId, user.id, {
        ...(data.startAt !== undefined ? { startAt: data.startAt } : {}),
        ...(data.endAt !== undefined ? { endAt: data.endAt } : {}),
        ...(data.status !== undefined ? { status: data.status } : {}),
        ...(data.supportsOnline !== undefined ? { supportsOnline: data.supportsOnline } : {}),
        ...(data.supportsOffline !== undefined ? { supportsOffline: data.supportsOffline } : {}),
      });
      res.json({ ok: true, data: slot });
    } catch (err) {
      next(err);
    }
  };

  deleteInterviewSlot = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = req.user!;
      const slotId = req.params.slotId!;
      const result = await this.service.deleteInterviewSlot(slotId, user.id);
      res.json({ ok: true, data: result });
    } catch (err) {
      next(err);
    }
  };

  listApplicationInterviewSlots = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = req.user!;
      const appId = req.params.appId!;
      const slots = await this.service.listApplicationInterviewSlots(appId, user.id);
      res.json({ ok: true, data: slots });
    } catch (err) {
      next(err);
    }
  };

  bookInterview = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = req.user!;
      const appId = req.params.appId!;
      const data = parseBody(bookInterviewSchema, req.body);
      const reservation = await this.service.bookInterview(
        appId,
        user.id,
        data,
        requireIdempotencyKey(req),
      );
      res.status(201).json({ ok: true, data: reservation });
    } catch (err) {
      next(err);
    }
  };

  closeJob = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = req.user!;
      const jobId = req.params.id!;
      const job = await this.service.closeJob(jobId, user.id);
      res.json({ ok: true, data: job });
    } catch (err) {
      next(err);
    }
  };

  createMilestone = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = req.user!;
      const appId = req.params.appId!;
      const data = parseBody(createMilestoneSchema, req.body);
      const milestone = await this.service.createMilestone(appId, user.id, data);
      res.status(201).json({ ok: true, data: milestone });
    } catch (err) {
      next(err);
    }
  };

  getMilestones = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = req.user!;
      const appId = req.params.appId!;
      const milestones = await this.service.getMilestones(appId, user.id);
      res.json({ ok: true, data: milestones });
    } catch (err) {
      next(err);
    }
  };

  submitMilestone = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = req.user!;
      const milestoneId = req.params.milestoneId!;
      const parsed = parseBody(submitMilestoneSchema, req.body);
      const data: { submissionNotes?: string; attachments?: unknown } = {};
      if (parsed.submissionNotes !== undefined) data.submissionNotes = parsed.submissionNotes;
      if (parsed.attachments !== undefined) data.attachments = parsed.attachments;
      const submission = await this.service.submitMilestone(milestoneId, user.id, data);
      res.status(201).json({ ok: true, data: submission });
    } catch (err) {
      next(err);
    }
  };

  reviewMilestone = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = req.user!;
      const milestoneId = req.params.milestoneId!;
      const { status } = parseBody(reviewMilestoneSchema, req.body);
      const milestone = await this.service.reviewMilestone(milestoneId, user.id, status);
      res.json({ ok: true, data: milestone });
    } catch (err) {
      next(err);
    }
  };

  getApplicationMessages = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = req.user!;
      const appId = req.params.appId!;
      const messages = await this.service.getApplicationMessages(appId, user.id);
      res.json({ ok: true, data: messages });
    } catch (err) {
      next(err);
    }
  };

  sendApplicationMessage = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = req.user!;
      const appId = req.params.appId!;
      const data = parseBody(applicationMessageSchema, req.body);
      const msg = await this.service.sendApplicationMessage(appId, user.id, data.content);
      res.status(201).json({ ok: true, data: msg });
    } catch (err) {
      next(err);
    }
  };
}

export const jobsController = new JobsController();
