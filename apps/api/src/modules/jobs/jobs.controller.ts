import type { Request, Response, NextFunction } from 'express';
import { JobsService } from './jobs.service.js';
import { z } from 'zod';
import { HttpError } from '../../utils/http-error.js';

const createJobSchema = z.object({
  title: z.string().min(3).max(300),
  description: z.string().min(10),
  requirements: z.string().optional(),
  salaryRange: z.string().optional(),
});

const applyJobSchema = z.object({
  coverLetter: z.string().optional(),
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
  status: z.enum(['pending', 'reviewed', 'accepted', 'rejected']),
});

const reviewMilestoneSchema = z.object({
  status: z.enum(['approved', 'rejected']),
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
      const job = await this.service.createJob(user.id, data);
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
