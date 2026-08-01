// ---------------------------------------------------------------------------
// Help & Resolution controller
// ---------------------------------------------------------------------------

import type { ApiSuccessBody, ResolutionCaseAvailabilityResponse } from '@mohandishub/shared';
import { RESOLUTION_CASE_KINDS } from '@mohandishub/shared';
import type { Request } from 'express';
import type { ZodSchema } from 'zod';

import { asyncHandler } from '../../utils/async-handler.js';
import { HttpError } from '../../utils/http-error.js';
import { logAudit } from '../audit/audit.service.js';

import type { ListCaseFilters } from './help-resolution.repository.js';
import type { CaseViewer } from './help-resolution.service.js';
import { HelpResolutionService } from './help-resolution.service.js';
import {
  addEvidenceSchema,
  adminStatusSchema,
  assignCaseSchema,
  createCaseSchema,
  escalateSchema,
  postMessageSchema,
  resolveCaseSchema,
} from './help-resolution.validation.js';

const service = new HelpResolutionService();

const STORED_STATUSES = new Set(['open', 'awaiting_user', 'under_review', 'resolved', 'closed']);

function requireViewer(req: Request): CaseViewer {
  const user = req.user;
  if (!user) {
    throw new HttpError({ statusCode: 401, code: 'UNAUTHORIZED', message: 'Auth required.' });
  }
  return { id: user.id, role: user.role ?? 'customer', isAdmin: user.isAdmin === true };
}

function requireCaseId(req: Request): string {
  const caseId = req.params.caseId;
  if (!caseId) {
    throw new HttpError({
      statusCode: 400,
      code: 'CASE_ID_REQUIRED',
      message: 'caseId is required.',
    });
  }
  return caseId;
}

function parseBody<T>(schema: ZodSchema<T>, body: unknown): T {
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    throw new HttpError({
      statusCode: 400,
      code: 'VALIDATION_ERROR',
      message: 'Invalid input.',
      details: parsed.error.flatten(),
    });
  }
  return parsed.data;
}

function parsePagination(req: Request): { page: number; limit: number } {
  const page = Math.max(parseInt((req.query.page as string) ?? '1', 10) || 1, 1);
  const limit = Math.min(Math.max(parseInt((req.query.limit as string) ?? '25', 10) || 25, 1), 100);
  return { page, limit };
}

function csv(value: unknown): string[] | undefined {
  if (typeof value !== 'string' || !value.trim()) return undefined;
  const parts = value
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
  return parts.length ? parts : undefined;
}

/**
 * Filters are a view over the caller's own cases, never a way to widen them.
 *
 * Unknown kinds and statuses are dropped rather than passed to SQL, and the
 * visibility predicate that decides which rows exist for this caller is applied
 * in the repository regardless of what arrives here.
 */
function parseFilters(req: Request): ListCaseFilters {
  const filters: ListCaseFilters = {};
  const kinds = csv(req.query.kind)?.filter((k) =>
    (RESOLUTION_CASE_KINDS as readonly string[]).includes(k),
  );
  if (kinds?.length) filters.kinds = kinds;

  // The UI's "closed" tab means both terminal statuses; `escalated` is a
  // projection and is asked for with its own flag.
  const statuses = csv(req.query.status)?.filter((s) => STORED_STATUSES.has(s));
  if (statuses?.length) filters.statuses = statuses;

  if (req.query.escalated === 'true') filters.escalatedOnly = true;

  const search = typeof req.query.search === 'string' ? req.query.search.trim() : '';
  if (search) filters.search = search.slice(0, 200);

  return filters;
}

// ---------------------------------------------------------------------------
// User routes
// ---------------------------------------------------------------------------

const listCases = asyncHandler(async (req, res) => {
  const viewer = requireViewer(req);
  const { page, limit } = parsePagination(req);
  const data = await service.listCases(viewer.id, parseFilters(req), page, limit);
  res.json({ ok: true, data } satisfies ApiSuccessBody<typeof data>);
});

const getAvailability = asyncHandler(async (req, res) => {
  const viewer = requireViewer(req);
  const items = await service.getAvailability(viewer.id);
  res.json({
    ok: true,
    data: { items },
  } satisfies ApiSuccessBody<ResolutionCaseAvailabilityResponse>);
});

const getCase = asyncHandler(async (req, res) => {
  const viewer = requireViewer(req);
  const data = await service.getCaseFile(requireCaseId(req), viewer.id);
  res.json({ ok: true, data } satisfies ApiSuccessBody<typeof data>);
});

const getCaseBySupportTicket = asyncHandler(async (req, res) => {
  const viewer = requireViewer(req);
  const ticketId = req.params.ticketId!;
  const data = await service.findCaseByLegacyId({ supportTicketId: ticketId }, viewer.id);
  res.json({ ok: true, data } satisfies ApiSuccessBody<typeof data>);
});

const getCaseByReservationDispute = asyncHandler(async (req, res) => {
  const viewer = requireViewer(req);
  const disputeId = req.params.disputeId!;
  const data = await service.findCaseByLegacyId({ reservationDisputeId: disputeId }, viewer.id);
  res.json({ ok: true, data } satisfies ApiSuccessBody<typeof data>);
});

const createCase = asyncHandler(async (req, res) => {
  const viewer = requireViewer(req);
  const input = parseBody(createCaseSchema, req.body);
  const data = await service.createCase(viewer, input);
  await logAudit({
    actorId: viewer.id,
    action: 'resolution_case.create',
    resourceType: 'resolution_case',
    resourceId: data.id,
    details: { kind: data.kind, referenceCode: data.referenceCode },
    ip: req.ip ?? req.socket?.remoteAddress ?? null,
  });
  res.status(201).json({ ok: true, data } satisfies ApiSuccessBody<typeof data>);
});

const postMessage = asyncHandler(async (req, res) => {
  const viewer = requireViewer(req);
  const input = parseBody(postMessageSchema, req.body);
  const data = await service.postMessage(requireCaseId(req), viewer, input);
  res.status(201).json({ ok: true, data } satisfies ApiSuccessBody<typeof data>);
});

const addEvidence = asyncHandler(async (req, res) => {
  const viewer = requireViewer(req);
  const input = parseBody(addEvidenceSchema, req.body);
  const caseId = requireCaseId(req);
  const data = await service.addEvidence(caseId, viewer, input);
  await logAudit({
    actorId: viewer.id,
    action: 'resolution_case.evidence.add',
    resourceType: 'resolution_case',
    resourceId: caseId,
    details: { evidenceId: data.id },
    ip: req.ip ?? req.socket?.remoteAddress ?? null,
  });
  res.status(201).json({ ok: true, data } satisfies ApiSuccessBody<typeof data>);
});

const escalate = asyncHandler(async (req, res) => {
  const viewer = requireViewer(req);
  const input = parseBody(escalateSchema, req.body ?? {});
  const caseId = requireCaseId(req);
  const data = await service.escalate(caseId, viewer, input);
  await logAudit({
    actorId: viewer.id,
    action: 'resolution_case.escalate',
    resourceType: 'resolution_case',
    resourceId: caseId,
    details: { referenceCode: data.referenceCode },
    ip: req.ip ?? req.socket?.remoteAddress ?? null,
  });
  res.json({ ok: true, data } satisfies ApiSuccessBody<typeof data>);
});

// ---------------------------------------------------------------------------
// Admin routes
// ---------------------------------------------------------------------------

const listAdminCases = asyncHandler(async (req, res) => {
  requireViewer(req);
  const { page, limit } = parsePagination(req);
  const filters = parseFilters(req);
  const assigned = typeof req.query.assignedTo === 'string' ? req.query.assignedTo.trim() : '';
  if (assigned) filters.assignedAdminId = assigned;
  const data = await service.listCasesForAdmin(filters, page, limit);
  res.json({ ok: true, data } satisfies ApiSuccessBody<typeof data>);
});

const getAdminCase = asyncHandler(async (req, res) => {
  requireViewer(req);
  const data = await service.getCaseFileForAdmin(requireCaseId(req));
  res.json({ ok: true, data } satisfies ApiSuccessBody<typeof data>);
});

const postAdminMessage = asyncHandler(async (req, res) => {
  const viewer = requireViewer(req);
  const input = parseBody(postMessageSchema, req.body);
  const caseId = requireCaseId(req);
  const data = await service.postAdminMessage(caseId, viewer, input);
  await logAudit({
    actorId: viewer.id,
    action:
      input.visibility === 'admin' ? 'admin.resolution_case.note' : 'admin.resolution_case.reply',
    resourceType: 'resolution_case',
    resourceId: caseId,
    details: { visibility: data.visibility },
    ip: req.ip ?? req.socket?.remoteAddress ?? null,
  });
  res.status(201).json({ ok: true, data } satisfies ApiSuccessBody<typeof data>);
});

const assignCase = asyncHandler(async (req, res) => {
  const viewer = requireViewer(req);
  const input = parseBody(assignCaseSchema, req.body);
  const caseId = requireCaseId(req);
  const data = await service.assign(caseId, input.adminId);
  await logAudit({
    actorId: viewer.id,
    action: 'admin.resolution_case.assign',
    resourceType: 'resolution_case',
    resourceId: caseId,
    details: { adminId: input.adminId },
    ip: req.ip ?? req.socket?.remoteAddress ?? null,
  });
  res.json({ ok: true, data } satisfies ApiSuccessBody<typeof data>);
});

const setStatus = asyncHandler(async (req, res) => {
  const viewer = requireViewer(req);
  const input = parseBody(adminStatusSchema, req.body);
  const caseId = requireCaseId(req);
  const data = await service.setAdminStatus(caseId, viewer, input.status);
  await logAudit({
    actorId: viewer.id,
    action: 'admin.resolution_case.status',
    resourceType: 'resolution_case',
    resourceId: caseId,
    details: { status: input.status },
    ip: req.ip ?? req.socket?.remoteAddress ?? null,
  });
  res.json({ ok: true, data } satisfies ApiSuccessBody<typeof data>);
});

const resolveCase = asyncHandler(async (req, res) => {
  const viewer = requireViewer(req);
  const input = parseBody(resolveCaseSchema, req.body);
  const caseId = requireCaseId(req);
  const data = await service.resolve(caseId, viewer, input);
  await logAudit({
    actorId: viewer.id,
    action: 'admin.resolution_case.resolve',
    resourceType: 'resolution_case',
    resourceId: caseId,
    details: { outcome: input.outcome, status: data.status },
    ip: req.ip ?? req.socket?.remoteAddress ?? null,
  });
  res.json({ ok: true, data } satisfies ApiSuccessBody<typeof data>);
});

export const helpResolutionController = {
  listCases,
  getAvailability,
  getCase,
  getCaseBySupportTicket,
  getCaseByReservationDispute,
  createCase,
  postMessage,
  addEvidence,
  escalate,
  listAdminCases,
  getAdminCase,
  postAdminMessage,
  assignCase,
  setStatus,
  resolveCase,
};
