import type { BackupRestoreStatus } from '@mohandishub/shared';
import { Router } from 'express';
import { z } from 'zod';

import { env } from '../../config/env.js';
import { getPool } from '../../db/pool.js';
import { requireAdminPermission } from '../../middleware/require-role.js';
import { asyncHandler } from '../../utils/async-handler.js';
import { HttpError } from '../../utils/http-error.js';

import {
  getBackupProviderStatus,
  runBackupProviderDryRun,
  runBackupProviderRestore,
} from './backup-providers.js';

const router = Router();
router.use(['/backups', '/restores'], requireAdminPermission('super_admin'));

const restoreRequestSchema = z.object({
  backupReference: z.string().trim().min(5).max(500),
  typedConfirmation: z.literal('RESTORE'),
});

async function superAdminCount(): Promise<number> {
  const { rows } = await getPool().query<{ count: string }>(
    `SELECT count(*)::text AS count
     FROM users
     WHERE is_admin = true
       AND COALESCE(admin_permissions, '[]'::jsonb) ? 'super_admin'
       AND deleted_at IS NULL`,
  );
  return parseInt(rows[0]?.count ?? '0', 10);
}

function requireAdminId(req: { user?: { id?: string } }) {
  if (!req.user?.id) {
    throw new HttpError({
      statusCode: 401,
      code: 'UNAUTHORIZED',
      message: 'Authentication required.',
    });
  }
  return req.user.id;
}

router.get(
  '/backups/status',
  asyncHandler(async (_req, res) => {
    const db = getPool();
    const [latestBackup, latestMigration, pendingRestores, admins, providerStatus] =
      await Promise.all([
        db.query<{ backup_reference: string | null; created_at: Date | null }>(
          `SELECT backup_reference, created_at
       FROM backup_restore_operations
       WHERE operation_type IN ('backup_check', 'restore_dry_run') AND status = 'completed'
       ORDER BY created_at DESC
       LIMIT 1`,
        ),
        db
          .query<{ version: string | null }>(
            `SELECT version::text
       FROM supabase_migrations.schema_migrations
       ORDER BY version DESC
       LIMIT 1`,
          )
          .catch(() => ({ rows: [] as Array<{ version: string | null }> })),
        db.query<{ count: string }>(
          `SELECT count(*)::text AS count
       FROM backup_restore_operations
       WHERE operation_type = 'restore_request' AND status IN ('pending', 'approved')`,
        ),
        superAdminCount(),
        getBackupProviderStatus().catch((err) => ({
          provider: env.BACKUP_PROVIDER,
          configured: false,
          status: err instanceof Error ? err.message : 'provider error',
          latestBackupReference: null,
          latestBackupAt: null,
        })),
      ]);
    const backup = latestBackup.rows[0];
    const data: BackupRestoreStatus = {
      latestBackupAt: providerStatus.latestBackupAt ?? backup?.created_at?.toISOString() ?? null,
      latestBackupReference:
        providerStatus.latestBackupReference ?? backup?.backup_reference ?? null,
      latestMigration: latestMigration.rows[0]?.version ?? null,
      restoreMode: admins > 1 ? 'two_person' : 'single_owner',
      pendingRestoreCount: parseInt(pendingRestores.rows[0]?.count ?? '0', 10),
      provider: providerStatus.provider,
      providerConfigured: providerStatus.configured,
      providerStatus: providerStatus.status,
    };
    res.json({ ok: true, data });
  }),
);

router.post(
  '/backups/check',
  asyncHandler(async (req, res) => {
    const adminId = requireAdminId(req);
    const provider = await getBackupProviderStatus();
    const reference = provider.latestBackupReference ?? `manual-check:${new Date().toISOString()}`;
    const { rows } = await getPool().query<{ id: string; created_at: Date }>(
      `INSERT INTO backup_restore_operations
       (requested_by, operation_type, status, backup_reference, provider, result, completed_at)
     VALUES ($1, 'backup_check', 'completed', $2, $3, $4, now())
     RETURNING id, created_at`,
      [
        adminId,
        reference,
        provider.provider,
        JSON.stringify({
          databaseUrlConfigured: Boolean(env.DATABASE_URL),
          sentryConfigured: Boolean(env.SENTRY_DSN),
          providerStatus: provider.status,
          latestBackupAt: provider.latestBackupAt,
        }),
      ],
    );
    res.status(201).json({ ok: true, data: rows[0] });
  }),
);

router.post(
  '/restores/dry-run',
  asyncHandler(async (req, res) => {
    const adminId = requireAdminId(req);
    const parsed = restoreRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new HttpError({
        statusCode: 400,
        code: 'VALIDATION_ERROR',
        message: 'Restore dry-run requires backupReference and typedConfirmation RESTORE.',
        details: parsed.error.flatten().fieldErrors,
      });
    }
    const providerResult = await runBackupProviderDryRun(parsed.data.backupReference);
    const { rows } = await getPool().query<{
      id: string;
      status: string;
      result: Record<string, unknown>;
      created_at: Date;
    }>(
      `INSERT INTO backup_restore_operations
       (requested_by, operation_type, status, backup_reference, typed_confirmation,
        provider, provider_operation_id, result, completed_at)
     VALUES ($1, 'restore_dry_run', 'completed', $2, $3, $4, $5, $6, now())
     RETURNING id, status, result, created_at`,
      [
        adminId,
        parsed.data.backupReference,
        parsed.data.typedConfirmation,
        providerResult.provider,
        providerResult.providerOperationId,
        JSON.stringify(providerResult.result),
      ],
    );
    res.status(201).json({ ok: true, data: rows[0] });
  }),
);

router.post(
  '/restores/request',
  asyncHandler(async (req, res) => {
    const adminId = requireAdminId(req);
    const parsed = restoreRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new HttpError({
        statusCode: 400,
        code: 'VALIDATION_ERROR',
        message: 'Restore request requires backupReference and typedConfirmation RESTORE.',
        details: parsed.error.flatten().fieldErrors,
      });
    }
    const mode = (await superAdminCount()) > 1 ? 'pending' : 'approved';
    const providerResult =
      mode === 'approved' ? await runBackupProviderRestore(parsed.data.backupReference) : null;
    const { rows } = await getPool().query<{
      id: string;
      status: string;
      created_at: Date;
      approved_at: Date | null;
    }>(
      `INSERT INTO backup_restore_operations
       (requested_by, operation_type, status, backup_reference, typed_confirmation,
        provider, provider_operation_id, result, approved_at, completed_at)
     VALUES ($1, 'restore_request', $2, $3, $4, $5, $6, $7,
             CASE WHEN $2 = 'approved' THEN now() ELSE NULL END,
             CASE WHEN $2 = 'approved' THEN now() ELSE NULL END)
     RETURNING id, status, created_at, approved_at`,
      [
        adminId,
        mode,
        parsed.data.backupReference,
        parsed.data.typedConfirmation,
        providerResult?.provider ?? env.BACKUP_PROVIDER,
        providerResult?.providerOperationId ?? null,
        JSON.stringify(
          providerResult?.result ?? { mode: mode === 'approved' ? 'single_owner' : 'two_person' },
        ),
      ],
    );
    res.status(201).json({ ok: true, data: rows[0] });
  }),
);

router.post(
  '/restores/:id/approve',
  asyncHandler(async (req, res) => {
    const adminId = requireAdminId(req);
    const { rows } = await getPool().query<{ requested_by: string; backup_reference: string }>(
      `SELECT requested_by, backup_reference FROM backup_restore_operations
     WHERE id = $1 AND operation_type = 'restore_request' AND status = 'pending'`,
      [req.params.id],
    );
    const row = rows[0];
    if (!row)
      throw new HttpError({
        statusCode: 404,
        code: 'RESTORE_NOT_FOUND',
        message: 'Pending restore not found.',
      });
    if (row.requested_by === adminId) {
      throw new HttpError({
        statusCode: 403,
        code: 'SECOND_APPROVER_REQUIRED',
        message: 'Restore approval must come from a different super admin.',
      });
    }
    const providerResult = await runBackupProviderRestore(row.backup_reference);
    const updated = await getPool().query<{ id: string; status: string; approved_at: Date }>(
      `UPDATE backup_restore_operations
     SET status = 'approved',
         approved_by = $2,
         approved_at = now(),
         completed_at = now(),
         provider = $3,
         provider_operation_id = $4,
         result = $5
     WHERE id = $1
     RETURNING id, status, approved_at`,
      [
        req.params.id,
        adminId,
        providerResult.provider,
        providerResult.providerOperationId,
        JSON.stringify(providerResult.result),
      ],
    );
    res.json({ ok: true, data: updated.rows[0] });
  }),
);

export { router as backupRestoreRouter };
