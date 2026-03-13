import { Router } from 'express';
import type { NextFunction, Request, Response } from 'express';

import { authenticate } from '../../middleware/authenticate.js';
import { requireEmailVerified } from '../../middleware/require-email-verified.js';
import { requireRole } from '../../middleware/require-role.js';
import { requireVerified } from '../../middleware/require-verified.js';

import { jobsController } from './jobs.controller.js';

const jobsRouter = Router();
const asHandler = (
  handler: (req: Request, res: Response, next: NextFunction) => Promise<void>,
) => {
  return (req: Request, res: Response, next: NextFunction): void => {
    void handler(req, res, next);
  };
};

jobsRouter.get('/', asHandler(jobsController.listOpenJobs));

const businessMw = [authenticate, requireEmailVerified, requireRole('business'), requireVerified];
const expertMw = [authenticate, requireEmailVerified, requireRole('expert'), requireVerified];

// Business endpoints
jobsRouter.post('/', ...businessMw, asHandler(jobsController.createJob));
jobsRouter.get('/my', ...businessMw, asHandler(jobsController.listBusinessJobs));
jobsRouter.get('/:id/interview-slots', ...businessMw, asHandler(jobsController.listBusinessInterviewSlots));
jobsRouter.post('/:id/interview-slots', ...businessMw, asHandler(jobsController.createInterviewSlot));
jobsRouter.get('/:id/applications', ...businessMw, asHandler(jobsController.getJobApplications));
jobsRouter.post('/:id/close', ...businessMw, asHandler(jobsController.closeJob));
jobsRouter.patch(
  '/applications/:appId/status',
  ...businessMw,
  asHandler(jobsController.updateApplicationStatus),
);
jobsRouter.patch('/interview-slots/:slotId', ...businessMw, asHandler(jobsController.updateInterviewSlot));
jobsRouter.delete('/interview-slots/:slotId', ...businessMw, asHandler(jobsController.deleteInterviewSlot));

jobsRouter.post('/applications/:appId/milestones', ...businessMw, asHandler(jobsController.createMilestone));
jobsRouter.get(
  '/applications/:appId/milestones',
  authenticate,
  requireEmailVerified,
  requireVerified,
  asHandler(jobsController.getMilestones),
);
jobsRouter.post('/milestones/:milestoneId/review', ...businessMw, asHandler(jobsController.reviewMilestone));

// Shared application messages endpoints
const sharedMw = [authenticate, requireEmailVerified, requireVerified];
jobsRouter.get(
  '/applications/:appId/interview-slots',
  ...sharedMw,
  asHandler(jobsController.listApplicationInterviewSlots),
);
jobsRouter.post(
  '/applications/:appId/interview-book',
  ...sharedMw,
  asHandler(jobsController.bookInterview),
);
jobsRouter.get('/applications/:appId/messages', ...sharedMw, asHandler(jobsController.getApplicationMessages));
jobsRouter.post(
  '/applications/:appId/messages',
  ...sharedMw,
  asHandler(jobsController.sendApplicationMessage),
);

// Expert endpoints
jobsRouter.get('/my-applications', ...expertMw, asHandler(jobsController.listExpertApplications));
jobsRouter.post('/:id/apply', ...expertMw, asHandler(jobsController.applyForJob));
jobsRouter.post('/milestones/:milestoneId/submit', ...expertMw, asHandler(jobsController.submitMilestone));

export { jobsRouter };
