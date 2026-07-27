import { asyncHandler } from '../../utils/async-handler.js';
import { HttpError } from '../../utils/http-error.js';
import { parsePagination } from '../../utils/pagination.js';

import { ReviewsService } from './reviews.service.js';
import {
  createReviewSchema,
  reportReviewSchema,
  disputeReviewSchema,
} from './reviews.validation.js';

const svc = new ReviewsService();

function requireUser(req: { user?: { id: string } }) {
  if (!req.user)
    throw new HttpError({ statusCode: 401, code: 'UNAUTHORIZED', message: 'Auth required.' });
  return req.user;
}

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

const create = asyncHandler(async (req, res) => {
  const user = requireUser(req);
  const input = parseBody(createReviewSchema, req.body);
  const review = await svc.create(user.id, input);
  res.status(201).json({ ok: true, data: review });
});

const list = asyncHandler(async (req, res) => {
  const targetUserId = req.query.targetUserId as string;
  const targetType =
    (req.query.targetType as 'expert' | 'business' | 'craftsman' | 'customer') || 'expert';
  if (!targetUserId) {
    throw new HttpError({
      statusCode: 400,
      code: 'MISSING_PARAMS',
      message: 'targetUserId is required.',
    });
  }
  const { page, limit } = parsePagination(req.query, { defaultLimit: 20, maxLimit: 50 });
  const data = await svc.listByTarget(targetUserId, targetType, page, limit);
  res.json({ ok: true, data });
});

const report = asyncHandler(async (req, res) => {
  const user = requireUser(req);
  const reviewId = req.params.reviewId as string;
  const input = parseBody(reportReviewSchema, req.body);
  const data = await svc.createReport(user.id, reviewId, input.reason, input.comment);
  res.status(201).json({ ok: true, data });
});

const dispute = asyncHandler(async (req, res) => {
  const user = requireUser(req);
  const reviewId = req.params.reviewId as string;
  const input = parseBody(disputeReviewSchema, req.body);
  const data = await svc.createDispute(user.id, reviewId, input.reason);
  res.status(201).json({ ok: true, data });
});

export const reviewsController = {
  create,
  list,
  report,
  dispute,
};
