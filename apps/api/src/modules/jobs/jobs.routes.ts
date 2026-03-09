import { Router } from 'express';

import { authenticate } from '../../middleware/authenticate.js';
import { requireEmailVerified } from '../../middleware/require-email-verified.js';
import { requireRole } from '../../middleware/require-role.js';
import { requireVerified } from '../../middleware/require-verified.js';

import { jobsController } from './jobs.controller.js';

const jobsRouter = Router();

jobsRouter.get('/', jobsController.listOpenJobs);

const businessMw = [authenticate, requireEmailVerified, requireRole('business'), requireVerified];
const expertMw = [authenticate, requireEmailVerified, requireRole('expert'), requireVerified];

// Business endpoints
jobsRouter.post('/', ...businessMw, jobsController.createJob);
jobsRouter.get('/my', ...businessMw, jobsController.listBusinessJobs);
jobsRouter.get('/:id/applications', ...businessMw, jobsController.getJobApplications);
jobsRouter.post('/:id/close', ...businessMw, jobsController.closeJob);
jobsRouter.patch('/applications/:appId/status', ...businessMw, jobsController.updateApplicationStatus);

jobsRouter.post('/applications/:appId/milestones', ...businessMw, jobsController.createMilestone);
jobsRouter.get('/applications/:appId/milestones', authenticate, requireEmailVerified, requireVerified, jobsController.getMilestones);
jobsRouter.post('/milestones/:milestoneId/review', ...businessMw, jobsController.reviewMilestone);

// Shared application messages endpoints
const sharedMw = [authenticate, requireEmailVerified, requireVerified];
jobsRouter.get('/applications/:appId/messages', ...sharedMw, jobsController.getApplicationMessages);
jobsRouter.post('/applications/:appId/messages', ...sharedMw, jobsController.sendApplicationMessage);

// Expert endpoints
jobsRouter.get('/my-applications', ...expertMw, jobsController.listExpertApplications);
jobsRouter.post('/:id/apply', ...expertMw, jobsController.applyForJob);
jobsRouter.post('/milestones/:milestoneId/submit', ...expertMw, jobsController.submitMilestone);

export { jobsRouter };
