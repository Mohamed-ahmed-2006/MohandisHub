import { canBidOnNeeds, canManageNeeds } from '@mohandishub/shared';

import { asyncHandler } from '../../utils/async-handler.js';
import { HttpError } from '../../utils/http-error.js';

import { NeedsService } from './needs.service.js';
import {
  awardBidSchema,
  createBidMessageSchema,
  createBidSchema,
  createNeedSchema,
  updateNeedSchema,
  updateBidSchema,
} from './needs.validation.js';

const svc = new NeedsService();

function requireUser(req: { user?: { id: string; role?: string } }) {
  if (!req.user)
    throw new HttpError({ statusCode: 401, code: 'UNAUTHORIZED', message: 'Auth required.' });
  return req.user;
}

function requireBidder(req: { user?: { id: string; role?: string } }) {
  const user = requireUser(req);
  if (!canBidOnNeeds(user.role ?? '')) {
    throw new HttpError({
      statusCode: 403,
      code: 'FORBIDDEN',
      message: 'Only individual providers can place and manage bids.',
    });
  }
  return user;
}

function requireCustomer(req: { user?: { id: string; role?: string } }) {
  const user = requireUser(req);
  if (!canManageNeeds(user.role ?? '')) {
    throw new HttpError({
      statusCode: 403,
      code: 'FORBIDDEN',
      message: 'Only customers can create and manage needs.',
    });
  }
  return user;
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

const createNeed = asyncHandler(async (req, res) => {
  const user = requireCustomer(req);
  const input = parseBody(createNeedSchema, req.body);
  const need = await svc.createNeed(user.id, input);
  res.status(201).json({ ok: true, data: need });
});

const listMyNeeds = asyncHandler(async (req, res) => {
  const user = requireUser(req);
  const page = parseInt(req.query.page as string, 10) || 1;
  const limit = Math.min(parseInt(req.query.limit as string, 10) || 20, 50);
  const data = await svc.listMyNeeds(user.id, page, limit);
  res.json({ ok: true, data });
});

const listOpenNeeds = asyncHandler(async (req, res) => {
  const page = parseInt(req.query.page as string, 10) || 1;
  const limit = Math.min(parseInt(req.query.limit as string, 10) || 20, 50);
  const categoryId = req.query.categoryId as string | undefined;
  const data = await svc.listOpenNeeds(page, limit, categoryId);
  res.json({ ok: true, data });
});

const getNeed = asyncHandler(async (req, res) => {
  const need = await svc.getNeed(req.params.id!);
  res.json({ ok: true, data: need });
});

const updateNeed = asyncHandler(async (req, res) => {
  const user = requireCustomer(req);
  const input = parseBody(updateNeedSchema, req.body);
  const need = await svc.updateNeed(req.params.id!, user.id, input);
  res.json({ ok: true, data: need });
});

const awardBid = asyncHandler(async (req, res) => {
  const user = requireCustomer(req);
  const { bidId } = parseBody(awardBidSchema, req.body);
  const result = await svc.awardBid(req.params.id!, bidId, user.id);
  res.json({ ok: true, data: result });
});

const payBid = asyncHandler(async (req, res) => {
  const user = requireCustomer(req);
  const result = await svc.payBid(req.params.id!, req.params.bidId!, user.id);
  res.json({ ok: true, data: result });
});

const createBid = asyncHandler(async (req, res) => {
  const user = requireBidder(req);
  const input = parseBody(createBidSchema, req.body);
  const bid = await svc.createBid(req.params.needId!, user.id, input);
  res.status(201).json({ ok: true, data: bid });
});

const listBidsForNeed = asyncHandler(async (req, res) => {
  const user = requireUser(req);
  const bids = await svc.listBidsForNeed(req.params.needId!, user.id);
  res.json({ ok: true, data: bids });
});

const listMyBids = asyncHandler(async (req, res) => {
  const user = requireBidder(req);
  const page = parseInt(req.query.page as string, 10) || 1;
  const limit = Math.min(parseInt(req.query.limit as string, 10) || 20, 50);
  const data = await svc.listMyBids(user.id, page, limit);
  res.json({ ok: true, data });
});

const updateBid = asyncHandler(async (req, res) => {
  const user = requireBidder(req);
  const input = parseBody(updateBidSchema, req.body);
  const bid = await svc.updateBid(req.params.needId!, req.params.bidId!, user.id, input);
  res.json({ ok: true, data: bid });
});

const deleteBid = asyncHandler(async (req, res) => {
  const user = requireBidder(req);
  await svc.deleteBid(req.params.needId!, req.params.bidId!, user.id);
  res.json({ ok: true });
});

const listBidMessages = asyncHandler(async (req, res) => {
  const user = requireUser(req);
  const messages = await svc.listBidMessages(req.params.needId!, req.params.bidId!, user.id);
  res.json({ ok: true, data: messages });
});

const createBidMessage = asyncHandler(async (req, res) => {
  const user = requireUser(req);
  const input = parseBody(createBidMessageSchema, req.body);
  const payload: { content: string; attachmentUrl?: string } = { content: input.content ?? '' };
  if (input.attachmentUrl) payload.attachmentUrl = input.attachmentUrl;
  const msg = await svc.createBidMessage(req.params.needId!, req.params.bidId!, user.id, payload);
  res.status(201).json({ ok: true, data: msg });
});

export const needsController = {
  createNeed,
  listMyNeeds,
  listOpenNeeds,
  getNeed,
  updateNeed,
  awardBid,
  payBid,
  createBid,
  listBidsForNeed,
  listMyBids,
  updateBid,
  deleteBid,
  listBidMessages,
  createBidMessage,
};
