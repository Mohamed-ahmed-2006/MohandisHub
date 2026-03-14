// ---------------------------------------------------------------------------
// Support controller — HTTP handlers for tickets
// ---------------------------------------------------------------------------

import type { ApiSuccessBody } from '@mohandishub/shared';

import { asyncHandler } from '../../utils/async-handler.js';
import { HttpError } from '../../utils/http-error.js';

import { SupportService } from './support.service.js';
import { createTicketSchema, replySchema } from './support.validation.js';

const supportService = new SupportService();

function requireUser(req: { user?: { id: string; isAdmin?: boolean } }) {
  if (!req.user) throw new HttpError({ statusCode: 401, code: 'UNAUTHORIZED', message: 'Auth required.' });
  return req.user;
}

function parseBody<T>(schema: { safeParse: (d: unknown) => { success: boolean; data?: T; error?: { flatten: () => unknown } } }, body: unknown): T {
  const r = schema.safeParse(body);
  if (!r.success) {
    const details = r.error?.flatten();
    throw new HttpError({ statusCode: 400, code: 'VALIDATION_ERROR', message: 'Invalid input.', ...(details ? { details } : {}) });
  }
  return r.data as T;
}

const createTicket = asyncHandler(async (req, res) => {
  const user = requireUser(req);
  const input = parseBody(createTicketSchema, req.body);
  const ticket = await supportService.createTicket(user.id, input.subject, input.body);
  res.status(201).json({ ok: true, data: ticket } as ApiSuccessBody<typeof ticket>);
});

const listMyTickets = asyncHandler(async (req, res) => {
  const user = requireUser(req);
  const page = Math.max(parseInt((req.query.page as string) ?? '1', 10), 1);
  const limit = Math.min(parseInt((req.query.limit as string) ?? '20', 10), 100);
  const data = await supportService.listMyTickets(user.id, page, limit);
  res.json({ ok: true, data });
});

const getTicket = asyncHandler(async (req, res) => {
  const user = requireUser(req);
  const ticket = await supportService.getTicket(req.params.ticketId!, user.id, user.isAdmin ?? false);
  if (!ticket) {
    throw new HttpError({ statusCode: 404, code: 'TICKET_NOT_FOUND', message: 'Ticket not found.' });
  }
  res.json({ ok: true, data: ticket });
});

const listMessages = asyncHandler(async (req, res) => {
  const user = requireUser(req);
  const messages = await supportService.listMessages(req.params.ticketId!, user.id, user.isAdmin ?? false);
  res.json({ ok: true, data: messages });
});

const reply = asyncHandler(async (req, res) => {
  const user = requireUser(req);
  const input = parseBody(replySchema, req.body);
  const message = await supportService.reply(
    req.params.ticketId!,
    user.id,
    input.body,
    user.isAdmin ?? false,
  );
  res.status(201).json({ ok: true, data: message });
});

export const supportController = {
  createTicket,
  listMyTickets,
  getTicket,
  listMessages,
  reply,
};
