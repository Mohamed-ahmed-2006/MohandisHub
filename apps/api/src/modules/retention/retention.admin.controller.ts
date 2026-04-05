import type { ApiSuccessBody } from '@mohandishub/shared';
import type { ZodType } from 'zod';

import { env } from '../../config/env.js';
import { asyncHandler } from '../../utils/async-handler.js';
import { HttpError } from '../../utils/http-error.js';
import { ModerationService } from '../moderation/moderation.service.js';
import { SettingsRepository } from '../settings/settings.repository.js';

import {
  moderationBidMessageSchema,
  moderationNeedSchema,
  moderationServiceImageSchema,
  patchRetentionGovernanceSchema,
  runRetentionSchema,
} from './retention.admin.validation.js';
import { RetentionRepository } from './retention.repository.js';
import { RetentionService } from './retention.service.js';
import type { RetentionPolicyJson } from './retention.types.js';

function parseBodyZod<T>(schema: ZodType<T>, body: unknown): T {
  const r = schema.safeParse(body);
  if (!r.success) {
    throw new HttpError({
      statusCode: 400,
      code: 'VALIDATION_ERROR',
      message: 'Invalid request body.',
      details: r.error.flatten(),
    });
  }
  return r.data;
}

const settingsRepo = new SettingsRepository();
const retentionService = new RetentionService();
const retentionRepo = new RetentionRepository();
const moderationService = new ModerationService();

function firstQueryString(val: unknown): string | undefined {
  if (typeof val === 'string' && val.length > 0) return val;
  if (Array.isArray(val) && typeof val[0] === 'string') return val[0];
  return undefined;
}

function parseMimes(raw: unknown): string[] | null {
  if (raw == null) return null;
  if (Array.isArray(raw)) {
    return raw.filter((x): x is string => typeof x === 'string');
  }
  return null;
}

export const getRetentionDashboard = asyncHandler(async (_req, res) => {
  const row = await settingsRepo.get();
  const base = await retentionService.getPolicyView();
  const policy = (row?.retention_policy as RetentionPolicyJson) ?? base.policy;
  const data = {
    ...base,
    policy,
    alerts: (row?.retention_alerts as (typeof base)['alerts']) ?? base.alerts,
    effectiveHours: retentionService.computeEffectiveHours(policy),
    upload: {
      maxPublicUploadBytes: row?.max_public_upload_bytes ?? null,
      publicUploadAllowedMimes: parseMimes(row?.public_upload_allowed_mimes),
      supabaseStorageDashboardUrl: row?.supabase_storage_dashboard_url ?? null,
      ceilingBytes: env.PUBLIC_UPLOAD_MAX_BYTES_CEILING,
    },
    workerDocUrl: '/docs/DEPLOYMENT_RUNBOOK.md',
  };
  res.json({ ok: true, data } satisfies ApiSuccessBody<typeof data>);
});

export const patchRetentionGovernance = asyncHandler(async (req, res) => {
  const body = parseBodyZod(patchRetentionGovernanceSchema, req.body);
  const partial: Parameters<SettingsRepository['update']>[0] = {};

  if (body.policy !== undefined) {
    const row = await settingsRepo.get();
    const current = (row?.retention_policy as RetentionPolicyJson) ?? {};
    partial.retention_policy = {
      ...current,
      ...body.policy,
      categories: {
        ...(current.categories ?? {}),
        ...(body.policy.categories ?? {}),
      },
    } as RetentionPolicyJson;
  }

  if (body.alerts !== undefined) {
    const row = await settingsRepo.get();
    const current = (row?.retention_alerts as Record<string, unknown>) ?? {};
    partial.retention_alerts = { ...current, ...body.alerts };
  }

  if (body.maxPublicUploadBytes !== undefined) {
    if (body.maxPublicUploadBytes != null && body.maxPublicUploadBytes > env.PUBLIC_UPLOAD_MAX_BYTES_CEILING) {
      throw new HttpError({
        statusCode: 400,
        code: 'ABOVE_CEILING',
        message: `maxPublicUploadBytes cannot exceed ${env.PUBLIC_UPLOAD_MAX_BYTES_CEILING}.`,
      });
    }
    partial.max_public_upload_bytes = body.maxPublicUploadBytes;
  }

  if (body.publicUploadAllowedMimes !== undefined) {
    partial.public_upload_allowed_mimes = body.publicUploadAllowedMimes;
  }

  if (body.supabaseStorageDashboardUrl !== undefined) {
    partial.supabase_storage_dashboard_url =
      body.supabaseStorageDashboardUrl === '' ? null : body.supabaseStorageDashboardUrl;
  }

  if (Object.keys(partial).length > 0) {
    await settingsRepo.update(partial);
  }

  res.json({ ok: true, data: { updated: true } } satisfies ApiSuccessBody<{ updated: boolean }>);
});

export const postRetentionRun = asyncHandler(async (req, res) => {
  const body = parseBodyZod(runRetentionSchema, req.body ?? {});
  const result = await retentionService.runSweep({
    dryRun: body.dryRun === true,
    trigger: 'manual',
  });
  if (result == null) {
    throw new HttpError({
      statusCode: 409,
      code: 'RETENTION_LOCK_BUSY',
      message: 'Another retention sweep is running.',
    });
  }
  res.json({ ok: true, data: result } satisfies ApiSuccessBody<typeof result>);
});

export const getRetentionSweepLogExport = asyncHandler(async (req, res) => {
  const format = firstQueryString(req.query.format) === 'csv' ? 'csv' : 'json';
  const limit = Math.min(
    5000,
    Math.max(1, parseInt(firstQueryString(req.query.limit) ?? '500', 10) || 500),
  );
  const range: { from?: Date; to?: Date; limit: number } = { limit };
  const fromQ = firstQueryString(req.query.from);
  const toQ = firstQueryString(req.query.to);
  if (fromQ) range.from = new Date(fromQ);
  if (toQ) range.to = new Date(toQ);
  const rows = await retentionRepo.listSweepLogsRange(range);

  if (format === 'csv') {
    const header = 'id,started_at,finished_at,dry_run,error,results_json\n';
    const lines = rows.map((r) =>
      [
        r.id,
        r.started_at.toISOString(),
        r.finished_at?.toISOString() ?? '',
        r.dry_run,
        (r.error ?? '').replaceAll('"', '""'),
        JSON.stringify(r.results ?? {}).replaceAll('"', '""'),
      ].join(','),
    );
    res.setHeader('Content-Type', 'text/csv');
    res.send(header + lines.join('\n'));
    return;
  }

  res.json({ ok: true, data: rows } satisfies ApiSuccessBody<typeof rows>);
});

export const getModerationLogExport = asyncHandler(async (req, res) => {
  const format = firstQueryString(req.query.format) === 'csv' ? 'csv' : 'json';
  const limit = Math.min(
    5000,
    Math.max(1, parseInt(firstQueryString(req.query.limit) ?? '500', 10) || 500),
  );
  const modRange: { from?: Date; to?: Date; limit: number } = { limit };
  const fromQ = firstQueryString(req.query.from);
  const toQ = firstQueryString(req.query.to);
  if (fromQ) modRange.from = new Date(fromQ);
  if (toQ) modRange.to = new Date(toQ);
  const rows = await moderationService.listLogsForExport(modRange);

  if (format === 'csv') {
    const header = 'id,admin_user_id,action,entity_type,entity_id,detail_json,created_at\n';
    const lines = rows.map((r) =>
      [
        r.id,
        r.admin_user_id,
        r.action,
        r.entity_type ?? '',
        r.entity_id ?? '',
        JSON.stringify(r.detail ?? {}).replaceAll('"', '""'),
        r.created_at.toISOString(),
      ].join(','),
    );
    res.setHeader('Content-Type', 'text/csv');
    res.send(header + lines.join('\n'));
    return;
  }

  res.json({ ok: true, data: rows } satisfies ApiSuccessBody<typeof rows>);
});

export const postModerationClearNeedReferences = asyncHandler(async (req, res) => {
  const user = req.user!;
  const { needId } = parseBodyZod(moderationNeedSchema, req.body);
  const data = await moderationService.clearNeedReferences(needId, user.id);
  res.json({ ok: true, data } satisfies ApiSuccessBody<typeof data>);
});

export const postModerationClearBidAttachment = asyncHandler(async (req, res) => {
  const user = req.user!;
  const { messageId } = parseBodyZod(moderationBidMessageSchema, req.body);
  const data = await moderationService.clearBidAttachment(messageId, user.id);
  res.json({ ok: true, data } satisfies ApiSuccessBody<typeof data>);
});

export const postModerationRemoveServiceImage = asyncHandler(async (req, res) => {
  const user = req.user!;
  const { serviceId, urlIndex } = parseBodyZod(moderationServiceImageSchema, req.body);
  const data = await moderationService.removeServiceImage(serviceId, urlIndex, user.id);
  res.json({ ok: true, data } satisfies ApiSuccessBody<typeof data>);
});
