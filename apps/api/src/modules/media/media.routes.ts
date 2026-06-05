import type { ApiSuccessBody } from '@mohandishub/shared';
import { Router } from 'express';
import { z } from 'zod';

import { authenticate } from '../../middleware/authenticate.js';
import { loadAdminFromDb } from '../../middleware/load-admin-from-db.js';
import { requireEmailVerified } from '../../middleware/require-email-verified.js';
import { requireAdminPermission, requireRole } from '../../middleware/require-role.js';
import { asyncHandler } from '../../utils/async-handler.js';
import { HttpError } from '../../utils/http-error.js';
import { logAudit } from '../audit/audit.service.js';

import {
  createMediaAsset,
  deleteMediaAsset,
  listActiveMediaAssets,
  listMediaAssets,
  updateMediaAsset,
} from './media.repository.js';

const usageTypeSchema = z.enum(['banner', 'announcement', 'hero', 'general']);

const createSchema = z.object({
  title: z.string().trim().min(1).max(140),
  altText: z.string().trim().max(280).nullish(),
  usageType: usageTypeSchema,
  imageUrl: z.string().trim().min(1).max(2048),
  active: z.boolean().optional(),
  sortOrder: z.number().int().min(0).max(9999).optional(),
  startsAt: z.string().datetime().optional().nullable(),
  endsAt: z.string().datetime().optional().nullable(),
});

const updateSchema = createSchema.partial();

const mediaRouter = Router();

mediaRouter.get(
  '/active',
  asyncHandler(async (req, res) => {
    const parsed = usageTypeSchema.safeParse(req.query.usageType);
    if (!parsed.success) {
      throw new HttpError({ statusCode: 400, code: 'INVALID_USAGE_TYPE', message: 'Invalid usage type.' });
    }
    const rows = await listActiveMediaAssets(parsed.data);
    res.json({ ok: true, data: rows } satisfies ApiSuccessBody<typeof rows>);
  }),
);

mediaRouter.get(
  '/',
  authenticate,
  requireEmailVerified,
  loadAdminFromDb,
  requireRole('admin'),
  requireAdminPermission('manage_media'),
  asyncHandler(async (req, res) => {
    const usageRaw = req.query.usageType;
    let usageType: z.infer<typeof usageTypeSchema> | undefined;
    if (typeof usageRaw === 'string' && usageRaw.length > 0) {
      const parsed = usageTypeSchema.safeParse(usageRaw);
      if (!parsed.success) {
        throw new HttpError({ statusCode: 400, code: 'INVALID_USAGE_TYPE', message: 'Invalid usage type.' });
      }
      usageType = parsed.data;
    }
    const rows = await listMediaAssets(usageType);
    res.json({ ok: true, data: rows } satisfies ApiSuccessBody<typeof rows>);
  }),
);

mediaRouter.post(
  '/',
  authenticate,
  requireEmailVerified,
  loadAdminFromDb,
  requireRole('admin'),
  requireAdminPermission('manage_media'),
  asyncHandler(async (req, res) => {
    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new HttpError({ statusCode: 400, code: 'VALIDATION_ERROR', message: 'Invalid media payload.' });
    }
    const payload = parsed.data;
    const row = await createMediaAsset({
      title: payload.title,
      altText: payload.altText ?? null,
      usageType: payload.usageType,
      imageUrl: payload.imageUrl,
      active: payload.active ?? true,
      sortOrder: payload.sortOrder ?? 0,
      startsAt: payload.startsAt ? new Date(payload.startsAt) : null,
      endsAt: payload.endsAt ? new Date(payload.endsAt) : null,
      createdBy: req.user?.id ?? null,
    });
    await logAudit({
      actorId: req.user?.id ?? null,
      action: 'admin.media.create',
      resourceType: 'media_asset',
      resourceId: row.id,
      details: {
        title: row.title,
        usageType: row.usage_type,
        active: row.active,
        sortOrder: row.sort_order,
        startsAt: row.starts_at,
        endsAt: row.ends_at,
      },
      ip: req.ip ?? req.socket?.remoteAddress ?? null,
    });
    res.status(201).json({ ok: true, data: row } satisfies ApiSuccessBody<typeof row>);
  }),
);

mediaRouter.patch(
  '/:id',
  authenticate,
  requireEmailVerified,
  loadAdminFromDb,
  requireRole('admin'),
  requireAdminPermission('manage_media'),
  asyncHandler(async (req, res) => {
    const mediaId = req.params.id;
    if (!mediaId) {
      throw new HttpError({ statusCode: 400, code: 'MEDIA_ID_REQUIRED', message: 'Media id is required.' });
    }
    const parsed = updateSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new HttpError({ statusCode: 400, code: 'VALIDATION_ERROR', message: 'Invalid media payload.' });
    }
    const payload = parsed.data;
    const row = await updateMediaAsset(mediaId, {
      ...(payload.title !== undefined ? { title: payload.title } : {}),
      ...(payload.altText !== undefined ? { altText: payload.altText ?? null } : {}),
      ...(payload.usageType !== undefined ? { usageType: payload.usageType } : {}),
      ...(payload.imageUrl !== undefined ? { imageUrl: payload.imageUrl } : {}),
      ...(payload.active !== undefined ? { active: payload.active } : {}),
      ...(payload.sortOrder !== undefined ? { sortOrder: payload.sortOrder } : {}),
      ...(payload.startsAt !== undefined ? { startsAt: payload.startsAt ? new Date(payload.startsAt) : null } : {}),
      ...(payload.endsAt !== undefined ? { endsAt: payload.endsAt ? new Date(payload.endsAt) : null } : {}),
    });
    if (!row) {
      throw new HttpError({ statusCode: 404, code: 'MEDIA_NOT_FOUND', message: 'Media asset not found.' });
    }
    await logAudit({
      actorId: req.user?.id ?? null,
      action: 'admin.media.update',
      resourceType: 'media_asset',
      resourceId: mediaId,
      details: {
        changedFields: Object.keys(payload).filter((key) => key !== 'imageUrl'),
        title: row.title,
        usageType: row.usage_type,
        active: row.active,
        sortOrder: row.sort_order,
        startsAt: row.starts_at,
        endsAt: row.ends_at,
      },
      ip: req.ip ?? req.socket?.remoteAddress ?? null,
    });
    res.json({ ok: true, data: row } satisfies ApiSuccessBody<typeof row>);
  }),
);

mediaRouter.delete(
  '/:id',
  authenticate,
  requireEmailVerified,
  loadAdminFromDb,
  requireRole('admin'),
  requireAdminPermission('manage_media'),
  asyncHandler(async (req, res) => {
    const mediaId = req.params.id;
    if (!mediaId) {
      throw new HttpError({ statusCode: 400, code: 'MEDIA_ID_REQUIRED', message: 'Media id is required.' });
    }
    const deleted = await deleteMediaAsset(mediaId);
    if (!deleted) {
      throw new HttpError({ statusCode: 404, code: 'MEDIA_NOT_FOUND', message: 'Media asset not found.' });
    }
    await logAudit({
      actorId: req.user?.id ?? null,
      action: 'admin.media.delete',
      resourceType: 'media_asset',
      resourceId: mediaId,
      details: { deleted: true },
      ip: req.ip ?? req.socket?.remoteAddress ?? null,
    });
    res.json({ ok: true, data: { deleted: true } } satisfies ApiSuccessBody<{ deleted: boolean }>);
  }),
);

export { mediaRouter };
