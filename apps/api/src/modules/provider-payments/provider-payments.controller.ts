import type { Request, Response } from 'express';

import { asyncHandler } from '../../utils/async-handler.js';
import { HttpError } from '../../utils/http-error.js';

import { ProviderPaymentsService } from './provider-payments.service.js';
import { upsertPaymentMethodSchema } from './provider-payments.validation.js';

const service = new ProviderPaymentsService();

function getUser(req: { user?: { id: string; role: string } }): { id: string; role: string } {
  if (!req.user) {
    throw new HttpError({
      statusCode: 401,
      code: 'UNAUTHORIZED',
      message: 'Authentication required.',
    });
  }
  return req.user;
}

function parseBody(body: unknown) {
  const result = upsertPaymentMethodSchema.safeParse(body);
  if (!result.success) {
    throw new HttpError({
      statusCode: 400,
      code: 'VALIDATION_ERROR',
      message: 'Invalid payment method details.',
      details: result.error.flatten().fieldErrors,
    });
  }
  return result.data;
}

function requireParam(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new HttpError({
      statusCode: 400,
      code: 'VALIDATION_ERROR',
      message: `${field} is required.`,
    });
  }
  return value.trim();
}

export const providerPaymentsController = {
  list: asyncHandler(async (req: Request, res: Response) => {
    const user = getUser(req);
    const data = await service.listMine({ userId: user.id, role: user.role });
    res.json({ success: true, data });
  }),

  create: asyncHandler(async (req: Request, res: Response) => {
    const user = getUser(req);
    const data = await service.create({
      userId: user.id,
      role: user.role,
      input: parseBody(req.body),
    });
    res.status(201).json({ success: true, data });
  }),

  update: asyncHandler(async (req: Request, res: Response) => {
    const user = getUser(req);
    const data = await service.update({
      userId: user.id,
      role: user.role,
      id: requireParam(req.params.id, 'id'),
      input: parseBody(req.body),
    });
    res.json({ success: true, data });
  }),

  remove: asyncHandler(async (req: Request, res: Response) => {
    const user = getUser(req);
    const data = await service.remove({
      userId: user.id,
      role: user.role,
      id: requireParam(req.params.id, 'id'),
    });
    res.json({ success: true, data });
  }),

  /** Customer pulls the provider's payment details for an activated award. */
  discloseForAward: asyncHandler(async (req: Request, res: Response) => {
    const user = getUser(req);
    const data = await service.discloseForAward({
      bidId: requireParam(req.params.bidId, 'bidId'),
      requesterId: user.id,
    });
    res.json({ success: true, data });
  }),

  myDisclosures: asyncHandler(async (req: Request, res: Response) => {
    const user = getUser(req);
    const data = await service.listMyDisclosures({ userId: user.id, role: user.role });
    res.json({ success: true, data });
  }),
};
