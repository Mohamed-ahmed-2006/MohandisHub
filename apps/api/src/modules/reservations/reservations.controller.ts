import { asyncHandler } from '../../utils/async-handler.js';
import { HttpError } from '../../utils/http-error.js';

import { ReservationsService } from './reservations.service.js';
import {
  callExtensionSchema,
  callHeartbeatSchema,
  callJoinSchema,
  confirmCheckinSchema,
  createReservationSchema,
  createReservationSlotSchema,
  decideReservationSchema,
  endCallSchema,
  finishReservationSchema,
  proposeLocationSchema,
  renewCallTokenSchema,
  resolveDisputeSchema,
  respondLocationSchema,
  updateReservationSlotSchema,
  upsertReservationProfileSchema,
} from './reservations.validation.js';

const svc = new ReservationsService();

function requireUser(req: { user?: { id: string; role?: string } }) {
  if (!req.user) {
    throw new HttpError({ statusCode: 401, code: 'UNAUTHORIZED', message: 'Auth required.' });
  }
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

const getMyProfile = asyncHandler(async (req, res) => {
  const user = requireUser(req);
  const role = user.role ?? 'customer';
  const profile = await svc.getMyProfile(user.id, role);
  res.json({ ok: true, data: profile });
});

const getProviderProfile = asyncHandler(async (req, res) => {
  const providerId = req.params.providerId;
  if (!providerId) {
    throw new HttpError({
      statusCode: 400,
      code: 'VALIDATION_ERROR',
      message: 'providerId is required.',
    });
  }
  const profile = await svc.getProviderProfile(providerId);
  res.json({ ok: true, data: profile });
});

const upsertMyProfile = asyncHandler(async (req, res) => {
  const user = requireUser(req);
  const role = user.role ?? 'customer';
  const input = parseBody(upsertReservationProfileSchema, req.body);
  const profile = await svc.upsertMyProfile(user.id, role, input);
  res.json({ ok: true, data: profile });
});

const listSlots = asyncHandler(async (req, res) => {
  const user = requireUser(req);
  const fromRaw = (req.query.from as string | undefined) ?? new Date().toISOString();
  const toRaw =
    (req.query.to as string | undefined) ??
    new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString();
  const from = new Date(fromRaw);
  const to = new Date(toRaw);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || to <= from) {
    throw new HttpError({
      statusCode: 400,
      code: 'VALIDATION_ERROR',
      message: 'Invalid from/to range.',
    });
  }
  const providerId = req.query.providerId as string | undefined;
  const availableOnly = String(req.query.availableOnly ?? '').toLowerCase() === 'true';
  const query: Parameters<ReservationsService['listSlots']>[0] = {
    userId: user.id,
    role: user.role ?? 'customer',
    from,
    to,
    availableOnly,
  };
  if (providerId !== undefined) query.providerId = providerId;
  const data = await svc.listSlots(query);
  res.json({ ok: true, data });
});

const createSlot = asyncHandler(async (req, res) => {
  const user = requireUser(req);
  const input = parseBody(createReservationSlotSchema, req.body);
  const slot = await svc.createSlot(user.id, user.role ?? 'customer', input);
  res.status(201).json({ ok: true, data: slot });
});

const updateSlot = asyncHandler(async (req, res) => {
  const user = requireUser(req);
  const slotId = req.params.slotId;
  if (!slotId) {
    throw new HttpError({
      statusCode: 400,
      code: 'VALIDATION_ERROR',
      message: 'slotId is required.',
    });
  }
  const input = parseBody(updateReservationSlotSchema, req.body);
  const slot = await svc.updateSlot(user.id, user.role ?? 'customer', slotId, input);
  res.json({ ok: true, data: slot });
});

const deleteSlot = asyncHandler(async (req, res) => {
  const user = requireUser(req);
  const slotId = req.params.slotId;
  if (!slotId) {
    throw new HttpError({
      statusCode: 400,
      code: 'VALIDATION_ERROR',
      message: 'slotId is required.',
    });
  }
  const result = await svc.deleteSlot(user.id, user.role ?? 'customer', slotId);
  res.json({ ok: true, data: result });
});

const createReservation = asyncHandler(async (req, res) => {
  const user = requireUser(req);
  const input = parseBody(createReservationSchema, req.body);
  const reservation = await svc.createReservation(user.id, input);
  res.status(201).json({ ok: true, data: reservation });
});

const listMyReservations = asyncHandler(async (req, res) => {
  const user = requireUser(req);
  const role = (req.query.role as string | undefined) ?? user.role ?? 'customer';
  const page = Math.max(parseInt((req.query.page as string | undefined) ?? '1', 10), 1);
  const limit = Math.min(
    Math.max(parseInt((req.query.limit as string | undefined) ?? '20', 10), 1),
    50,
  );
  const data = await svc.listMyReservations(user.id, role, page, limit);
  res.json({ ok: true, data });
});

const getReservationById = asyncHandler(async (req, res) => {
  const user = requireUser(req);
  const reservationId = req.params.reservationId;
  if (!reservationId) {
    throw new HttpError({
      statusCode: 400,
      code: 'VALIDATION_ERROR',
      message: 'reservationId is required.',
    });
  }
  const reservation = await svc.getReservationById(user.id, reservationId);
  res.json({ ok: true, data: reservation });
});

const decideReservation = asyncHandler(async (req, res) => {
  const user = requireUser(req);
  const reservationId = req.params.reservationId;
  if (!reservationId) {
    throw new HttpError({
      statusCode: 400,
      code: 'VALIDATION_ERROR',
      message: 'reservationId is required.',
    });
  }
  const input = parseBody(decideReservationSchema, req.body);
  const reservation = await svc.decideReservation(user.id, reservationId, input);
  res.json({ ok: true, data: reservation });
});

const listLocationProposals = asyncHandler(async (req, res) => {
  const user = requireUser(req);
  const reservationId = req.params.reservationId;
  if (!reservationId) {
    throw new HttpError({
      statusCode: 400,
      code: 'VALIDATION_ERROR',
      message: 'reservationId is required.',
    });
  }
  const data = await svc.listLocationProposals(user.id, reservationId);
  res.json({ ok: true, data });
});

const proposeLocation = asyncHandler(async (req, res) => {
  const user = requireUser(req);
  const reservationId = req.params.reservationId;
  if (!reservationId) {
    throw new HttpError({
      statusCode: 400,
      code: 'VALIDATION_ERROR',
      message: 'reservationId is required.',
    });
  }
  const input = parseBody(proposeLocationSchema, req.body);
  const data = await svc.proposeLocation(user.id, reservationId, input);
  res.status(201).json({ ok: true, data });
});

const respondLocation = asyncHandler(async (req, res) => {
  const user = requireUser(req);
  const reservationId = req.params.reservationId;
  if (!reservationId) {
    throw new HttpError({
      statusCode: 400,
      code: 'VALIDATION_ERROR',
      message: 'reservationId is required.',
    });
  }
  const input = parseBody(respondLocationSchema, req.body);
  const data = await svc.respondLocation(user.id, reservationId, input);
  res.json({ ok: true, data });
});

const getOfflineCheckinCodes = asyncHandler(async (req, res) => {
  const user = requireUser(req);
  const reservationId = req.params.reservationId;
  if (!reservationId) {
    throw new HttpError({
      statusCode: 400,
      code: 'VALIDATION_ERROR',
      message: 'reservationId is required.',
    });
  }
  const data = await svc.getOfflineCheckinCodes(user.id, reservationId);
  res.json({ ok: true, data });
});

const confirmOfflineCheckin = asyncHandler(async (req, res) => {
  const user = requireUser(req);
  const reservationId = req.params.reservationId;
  if (!reservationId) {
    throw new HttpError({
      statusCode: 400,
      code: 'VALIDATION_ERROR',
      message: 'reservationId is required.',
    });
  }
  const input = parseBody(confirmCheckinSchema, req.body);
  const data = await svc.confirmOfflineCheckin(user.id, reservationId, input);
  res.json({ ok: true, data });
});

const finishReservation = asyncHandler(async (req, res) => {
  const user = requireUser(req);
  const reservationId = req.params.reservationId;
  if (!reservationId) {
    throw new HttpError({
      statusCode: 400,
      code: 'VALIDATION_ERROR',
      message: 'reservationId is required.',
    });
  }
  const input = parseBody(finishReservationSchema, req.body);
  const data = await svc.finishReservation(user.id, reservationId, input);
  res.json({ ok: true, data });
});

const joinCall = asyncHandler(async (req, res) => {
  const user = requireUser(req);
  const reservationId = req.params.reservationId;
  if (!reservationId) {
    throw new HttpError({
      statusCode: 400,
      code: 'VALIDATION_ERROR',
      message: 'reservationId is required.',
    });
  }
  const input = parseBody(callJoinSchema, req.body);
  const data = await svc.joinCall(user.id, reservationId, input);
  res.json({ ok: true, data });
});

const callHeartbeat = asyncHandler(async (req, res) => {
  const user = requireUser(req);
  const reservationId = req.params.reservationId;
  if (!reservationId) {
    throw new HttpError({
      statusCode: 400,
      code: 'VALIDATION_ERROR',
      message: 'reservationId is required.',
    });
  }
  const input = parseBody(callHeartbeatSchema, req.body);
  const data = await svc.callHeartbeat(user.id, reservationId, input);
  res.json({ ok: true, data });
});

const decideCallExtension = asyncHandler(async (req, res) => {
  const user = requireUser(req);
  const reservationId = req.params.reservationId;
  if (!reservationId) {
    throw new HttpError({
      statusCode: 400,
      code: 'VALIDATION_ERROR',
      message: 'reservationId is required.',
    });
  }
  const input = parseBody(callExtensionSchema, req.body);
  const data = await svc.decideCallExtension(user.id, reservationId, input);
  res.json({ ok: true, data });
});

const endCall = asyncHandler(async (req, res) => {
  const user = requireUser(req);
  const reservationId = req.params.reservationId;
  if (!reservationId) {
    throw new HttpError({
      statusCode: 400,
      code: 'VALIDATION_ERROR',
      message: 'reservationId is required.',
    });
  }
  const input = parseBody(endCallSchema, req.body);
  const data = await svc.endCall(user.id, reservationId, input);
  res.json({ ok: true, data });
});

const renewCallToken = asyncHandler(async (req, res) => {
  const user = requireUser(req);
  const reservationId = req.params.reservationId;
  if (!reservationId) {
    throw new HttpError({
      statusCode: 400,
      code: 'VALIDATION_ERROR',
      message: 'reservationId is required.',
    });
  }
  parseBody(renewCallTokenSchema, req.body ?? {});
  const data = await svc.renewCallToken(user.id, reservationId);
  res.json({ ok: true, data });
});

const getCallSnapshot = asyncHandler(async (req, res) => {
  const user = requireUser(req);
  const reservationId = req.params.reservationId;
  if (!reservationId) {
    throw new HttpError({
      statusCode: 400,
      code: 'VALIDATION_ERROR',
      message: 'reservationId is required.',
    });
  }
  const data = await svc.getCallSnapshot(user.id, reservationId);
  res.json({ ok: true, data });
});

const listDisputes = asyncHandler(async (req, res) => {
  const user = requireUser(req);
  const page = Math.max(parseInt((req.query.page as string | undefined) ?? '1', 10), 1);
  const limit = Math.min(
    Math.max(parseInt((req.query.limit as string | undefined) ?? '20', 10), 1),
    100,
  );
  const status = (req.query.status as string | undefined) ?? undefined;
  const data = await svc.listDisputes(user.id, user.role ?? 'customer', page, limit, status);
  res.json({ ok: true, data });
});

const resolveDispute = asyncHandler(async (req, res) => {
  const user = requireUser(req);
  const disputeId = req.params.disputeId;
  if (!disputeId) {
    throw new HttpError({
      statusCode: 400,
      code: 'VALIDATION_ERROR',
      message: 'disputeId is required.',
    });
  }
  const input = parseBody(resolveDisputeSchema, req.body);
  const data = await svc.resolveDispute(user.id, user.role ?? 'customer', disputeId, input);
  res.json({ ok: true, data });
});

export const reservationsController = {
  getMyProfile,
  getProviderProfile,
  upsertMyProfile,
  listSlots,
  createSlot,
  updateSlot,
  deleteSlot,
  createReservation,
  listMyReservations,
  getReservationById,
  decideReservation,
  listLocationProposals,
  proposeLocation,
  respondLocation,
  getOfflineCheckinCodes,
  confirmOfflineCheckin,
  finishReservation,
  joinCall,
  callHeartbeat,
  decideCallExtension,
  endCall,
  renewCallToken,
  getCallSnapshot,
  listDisputes,
  resolveDispute,
};
