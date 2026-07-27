import type {
  ApiSuccessBody,
  NegotiationDetailResponse,
  NegotiationListResponse,
} from '@mohandishub/shared';

import { asyncHandler } from '../../utils/async-handler.js';
import { HttpError } from '../../utils/http-error.js';
import { parsePagination } from '../../utils/pagination.js';

import { NegotiationsService } from './negotiations.service.js';
import { createNegotiationSchema, respondNegotiationSchema } from './negotiations.validation.js';

const svc = new NegotiationsService();

function requireUser(req: { user?: { id: string } }) {
  if (!req.user)
    throw new HttpError({ statusCode: 401, code: 'UNAUTHORIZED', message: 'Auth required.' });
  return req.user.id;
}

function parseBody<T>(
  schema: { safeParse: (d: unknown) => { success: boolean; data?: T } },
  body: unknown,
): T {
  const r = schema.safeParse(body);
  if (!r.success)
    throw new HttpError({ statusCode: 400, code: 'VALIDATION_ERROR', message: 'Invalid input.' });
  return r.data as T;
}

const create = asyncHandler(async (req, res) => {
  const userId = requireUser(req);
  const input = parseBody(createNegotiationSchema, req.body);
  const data = await svc.createNegotiation(userId, input);
  res.status(201).json({ ok: true, data } as ApiSuccessBody<NegotiationDetailResponse>);
});

const list = asyncHandler(async (req, res) => {
  const userId = requireUser(req);
  const role = req.query.role as 'customer' | 'provider';
  if (role !== 'customer' && role !== 'provider') {
    throw new HttpError({
      statusCode: 400,
      code: 'VALIDATION_ERROR',
      message: 'role must be customer or provider.',
    });
  }
  const status = typeof req.query.status === 'string' ? req.query.status : undefined;
  const serviceId = typeof req.query.serviceId === 'string' ? req.query.serviceId : undefined;
  const { page, limit } = parsePagination(req.query, { defaultLimit: 20, maxLimit: 50 });
  const data = await svc.listNegotiations(userId, role, status, serviceId, page, limit);
  res.json({ ok: true, data } as ApiSuccessBody<NegotiationListResponse>);
});

const getById = asyncHandler(async (req, res) => {
  const userId = requireUser(req);
  const id = req.params.id!;
  const data = await svc.getDetail(userId, id);
  res.json({ ok: true, data } as ApiSuccessBody<NegotiationDetailResponse>);
});

const respond = asyncHandler(async (req, res) => {
  const userId = requireUser(req);
  const id = req.params.id!;
  const input = parseBody(respondNegotiationSchema, req.body);
  const data = await svc.respondToNegotiation(userId, id, input);
  res.json({ ok: true, data } as ApiSuccessBody<NegotiationDetailResponse>);
});

const cancel = asyncHandler(async (req, res) => {
  const userId = requireUser(req);
  const id = req.params.id!;
  const data = await svc.cancelNegotiation(userId, id);
  res.json({ ok: true, data } as ApiSuccessBody<NegotiationDetailResponse>);
});

export const negotiationsController = { create, list, getById, respond, cancel };
