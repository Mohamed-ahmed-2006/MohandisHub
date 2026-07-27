import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import type { ApiSuccessBody } from '@mohandishub/shared';
import type { NextFunction, Request, Response } from 'express';
import { Router } from 'express';
import multer from 'multer';

import { env } from '../../config/env.js';
import {
  UPLOADS_BUCKET,
  createPrivateSignedUrl,
  isSupabaseStorageConfigured,
  uploadToSupabase,
  uploadToSupabasePrivate,
} from '../../lib/supabase-storage.js';
import { authenticate } from '../../middleware/authenticate.js';
import { loadAdminFromDb } from '../../middleware/load-admin-from-db.js';
import { uploadRateLimiter } from '../../middleware/rate-limit.js';
import { requireEmailVerified } from '../../middleware/require-email-verified.js';
import { hasAdminPermission } from '../../middleware/require-role.js';
import { asyncHandler } from '../../utils/async-handler.js';
import { HttpError } from '../../utils/http-error.js';
import { SettingsService } from '../settings/settings.service.js';

import {
  ALLOWED_UPLOAD_MIMES,
  detectAndValidateUpload,
  removeTemporaryUpload,
} from './upload-file.js';
import {
  activatePublicUploadObject,
  createPlannedUploadObject,
  findPrivateUploadById,
  insertPrivateUpload,
  isJobOwnerOfApplicationWithCv,
  isMoneyProofVisibleToUser,
  markUploadObjectFailed,
} from './upload.repository.js';

const settingsService = new SettingsService();
const PRIVATE_BUCKET = 'verification-docs';
const PRIVATE_BUCKET_LOCAL = 'local';

const UPLOAD_DIR = path.resolve(process.cwd(), 'uploads');
const UPLOAD_PRIVATE_DIR = path.join(UPLOAD_DIR, 'private');
if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}
if (!fs.existsSync(UPLOAD_PRIVATE_DIR)) {
  fs.mkdirSync(UPLOAD_PRIVATE_DIR, { recursive: true });
}

const DEFAULT_MAX_SIZE = 15 * 1024 * 1024;
const MAX_CONCURRENT_UPLOADS = 2;
let activeUploads = 0;

function uploadConcurrencyGuard(_req: Request, res: Response, next: NextFunction): void {
  if (activeUploads >= MAX_CONCURRENT_UPLOADS) {
    throw new HttpError({
      statusCode: 429,
      code: 'UPLOAD_CONCURRENCY_LIMIT',
      message: 'Too many uploads are in progress. Please retry shortly.',
    });
  }

  activeUploads += 1;
  let released = false;
  const release = (): void => {
    if (released) return;
    released = true;
    activeUploads = Math.max(0, activeUploads - 1);
  };
  res.once('finish', release);
  res.once('close', release);
  next();
}

function parseSettingsMimes(raw: unknown): string[] | null {
  if (raw == null) return null;
  if (Array.isArray(raw)) {
    const out = raw.filter((x): x is string => typeof x === 'string');
    return out.length > 0 ? out : null;
  }
  return null;
}

/** MIME check runs after upload using app_settings allowlist (or defaults). */
const permissiveFileFilter = (
  _req: Express.Request,
  _file: Express.Multer.File,
  cb: (err: Error | null, accept?: boolean) => void,
): void => {
  cb(null, true);
};

const diskStorage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
  filename: (_req, _file, cb) => cb(null, `tmp-${randomUUID()}`),
});

const memoryStorage = multer.memoryStorage();

const upload = multer({
  storage: isSupabaseStorageConfigured() ? memoryStorage : diskStorage,
  limits: { fileSize: env.PUBLIC_UPLOAD_MAX_BYTES_CEILING },
  fileFilter: permissiveFileFilter,
});

const uploadRouter = Router();

/** In production, disk uploads are wiped on redeploy (e.g. Render). Require object storage. */
const requireDurableStorageInProduction = asyncHandler((_req, _res, next) => {
  if (env.NODE_ENV === 'production' && !isSupabaseStorageConfigured()) {
    throw new HttpError({
      statusCode: 503,
      code: 'STORAGE_NOT_CONFIGURED',
      message:
        'File uploads require Supabase Storage in production (SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY). Without them, logos and other files are lost on every deploy.',
    });
  }
  next();
});

uploadRouter.post(
  '/',
  authenticate,
  uploadRateLimiter,
  uploadConcurrencyGuard,
  requireEmailVerified,
  asyncHandler(async (_req, res, next) => {
    const status = await settingsService.getAppStatus();
    if (status.pauseUploads) {
      throw new HttpError({
        statusCode: 503,
        code: 'UPLOADS_PAUSED',
        message: 'File uploads are temporarily disabled.',
      });
    }
    next();
  }),
  requireDurableStorageInProduction,
  upload.single('file'),
  asyncHandler(async (req, res) => {
    if (!req.file) {
      throw new HttpError({ statusCode: 400, code: 'NO_FILE', message: 'No file provided.' });
    }
    let uploadObjectId: string | null = null;
    let storageMayExist = false;
    try {
      const settingsRow = await settingsService.getRawRow();
      const customMimes = parseSettingsMimes(settingsRow?.public_upload_allowed_mimes);
      const effectiveMimes = customMimes ?? ALLOWED_UPLOAD_MIMES;
      const detected = await detectAndValidateUpload(req.file, effectiveMimes);
      const maxBytes = Math.min(
        env.PUBLIC_UPLOAD_MAX_BYTES_CEILING,
        settingsRow?.max_public_upload_bytes ?? DEFAULT_MAX_SIZE,
      );
      if (detected.size > maxBytes) {
        throw new HttpError({
          statusCode: 413,
          code: 'FILE_TOO_LARGE',
          message: `File exceeds maximum size of ${maxBytes} bytes.`,
        });
      }

      const useSupabase = isSupabaseStorageConfigured();
      const objectPath = `${randomUUID()}.${detected.extension}`;
      const bucket = useSupabase ? UPLOADS_BUCKET : 'local-public';
      const planned = await createPlannedUploadObject({
        userId: req.user!.id,
        bucket,
        storagePath: objectPath,
        visibility: 'public',
        originalName: req.file.originalname,
        detectedMime: detected.mime,
        sizeBytes: detected.size,
        sha256: detected.sha256,
      });
      uploadObjectId = planned.id;

      let fileUrl: string;
      if (useSupabase) {
        const result = await uploadToSupabase(detected.buffer, objectPath, detected.mime);
        storageMayExist = true;
        fileUrl = result.url;
      } else {
        if (!req.file.path) throw new Error('Temporary upload path is missing');
        fs.renameSync(req.file.path, path.join(UPLOAD_DIR, objectPath));
        storageMayExist = true;
        fileUrl = `/uploads/${objectPath}`;
      }

      await activatePublicUploadObject(planned.id);
      const response: ApiSuccessBody<{
        url: string;
        filename: string;
        originalName: string;
        uploadId: string;
      }> = {
        ok: true,
        data: {
          url: fileUrl,
          filename: objectPath,
          originalName: req.file.originalname,
          uploadId: planned.id,
        },
      };
      res.status(201).json(response);
    } catch (error) {
      if (uploadObjectId) {
        try {
          await markUploadObjectFailed(uploadObjectId, storageMayExist);
        } catch {
          // Preserve the original upload error; the planned row remains reconcilable.
        }
      }
      throw error;
    } finally {
      await removeTemporaryUpload(req.file);
    }
  }),
);

// ---------------------------------------------------------------------------
// Private uploads (verification docs, CV): stored in verification-docs bucket,
// no public URL returned. Client gets /api/upload/private/:id; GET returns
// signed redirect or 403 if not owner/admin.
// ---------------------------------------------------------------------------

uploadRouter.post(
  '/private',
  authenticate,
  uploadRateLimiter,
  uploadConcurrencyGuard,
  requireEmailVerified,
  asyncHandler(async (req, res, next) => {
    const status = await settingsService.getAppStatus();
    if (status.pauseUploads) {
      throw new HttpError({
        statusCode: 503,
        code: 'UPLOADS_PAUSED',
        message: 'File uploads are temporarily disabled.',
      });
    }
    next();
  }),
  requireDurableStorageInProduction,
  upload.single('file'),
  asyncHandler(async (req, res) => {
    if (!req.file) {
      throw new HttpError({ statusCode: 400, code: 'NO_FILE', message: 'No file provided.' });
    }
    let uploadObjectId: string | null = null;
    let storageMayExist = false;
    try {
      const settingsRow = await settingsService.getRawRow();
      const customMimes = parseSettingsMimes(settingsRow?.public_upload_allowed_mimes);
      const effectiveMimes = customMimes ?? ALLOWED_UPLOAD_MIMES;
      const detected = await detectAndValidateUpload(req.file, effectiveMimes);
      const maxBytes = Math.min(
        env.PUBLIC_UPLOAD_MAX_BYTES_CEILING,
        settingsRow?.max_public_upload_bytes ?? DEFAULT_MAX_SIZE,
      );
      if (detected.size > maxBytes) {
        throw new HttpError({
          statusCode: 413,
          code: 'FILE_TOO_LARGE',
          message: `File exceeds maximum size of ${maxBytes} bytes.`,
        });
      }

      const user = req.user!;
      const useSupabase = isSupabaseStorageConfigured();
      const filename = `${randomUUID()}.${detected.extension}`;
      const storagePath = useSupabase ? filename : `private/${filename}`;
      const bucket = useSupabase ? PRIVATE_BUCKET : PRIVATE_BUCKET_LOCAL;
      const planned = await createPlannedUploadObject({
        userId: user.id,
        bucket,
        storagePath,
        visibility: 'private',
        originalName: req.file.originalname,
        detectedMime: detected.mime,
        sizeBytes: detected.size,
        sha256: detected.sha256,
      });
      uploadObjectId = planned.id;

      if (useSupabase) {
        await uploadToSupabasePrivate(detected.buffer, storagePath, detected.mime);
        storageMayExist = true;
      } else {
        if (!req.file.path) throw new Error('Temporary upload path is missing');
        fs.renameSync(req.file.path, path.join(UPLOAD_PRIVATE_DIR, filename));
        storageMayExist = true;
      }

      const row = await insertPrivateUpload({
        uploadObjectId: planned.id,
        storagePath,
        bucket,
        userId: user.id,
        originalName: req.file.originalname,
        detectedMime: detected.mime,
        sizeBytes: detected.size,
        sha256: detected.sha256,
      });
      const url = `/api/upload/private/${row.id}`;
      const response: ApiSuccessBody<{
        url: string;
        filename: string;
        originalName: string;
        uploadId: string;
      }> = {
        ok: true,
        data: {
          url,
          filename: row.id,
          originalName: req.file.originalname,
          uploadId: planned.id,
        },
      };
      res.status(201).json(response);
    } catch (error) {
      if (uploadObjectId) {
        try {
          await markUploadObjectFailed(uploadObjectId, storageMayExist);
        } catch {
          // Preserve the original upload error; the planned row remains reconcilable.
        }
      }
      throw error;
    } finally {
      await removeTemporaryUpload(req.file);
    }
  }),
);

const SIGNED_URL_EXPIRY_SECONDS = 900; // 15 min

/**
 * Return `{ url }` JSON only when the client explicitly requests JSON (signed-URL API).
 * `req.accepts('application/json')` is true for broad Accept wildcards, which made the
 * Next.js private-upload proxy receive JSON instead of bytes/redirect — previews broke.
 */
function wantsPrivateUploadJson(req: Request): boolean {
  const accept = req.get('Accept') ?? '';
  const lower = accept.toLowerCase();
  const types = accept
    .split(',')
    .map((part) => part.trim().split(';')[0]?.trim().toLowerCase() ?? '');
  const hasExplicitJson = types.some((t) => t === 'application/json' || t === 'text/json');
  const wantsInlineMedia =
    /\bimage\//i.test(lower) || /\bapplication\/pdf\b/i.test(lower) || /\bvideo\//i.test(lower);
  return hasExplicitJson && !wantsInlineMedia;
}

function canAdminReadPrivateUpload(user: {
  isAdmin?: boolean;
  adminPermissions?: string[];
}): boolean {
  return (
    hasAdminPermission(user, 'manage_verifications') ||
    hasAdminPermission(user, 'manage_transactions')
  );
}

uploadRouter.get(
  '/private/:id',
  authenticate,
  loadAdminFromDb,
  asyncHandler(async (req, res) => {
    const row = await findPrivateUploadById(req.params.id!);
    if (!row) {
      throw new HttpError({ statusCode: 404, code: 'NOT_FOUND', message: 'File not found.' });
    }
    const user = req.user!;
    if (row.user_id !== user.id && !canAdminReadPrivateUpload(user)) {
      const jobOwner = await isJobOwnerOfApplicationWithCv(user.id, row.id);
      const moneyProofOwner = jobOwner ? true : await isMoneyProofVisibleToUser(user.id, row.id);
      if (!jobOwner && !moneyProofOwner) {
        throw new HttpError({ statusCode: 403, code: 'FORBIDDEN', message: 'Access denied.' });
      }
    }
    const wantsJson = wantsPrivateUploadJson(req);
    if (row.bucket === PRIVATE_BUCKET_LOCAL) {
      const localPath = path.resolve(UPLOAD_DIR, row.storage_path);
      if (!localPath.startsWith(UPLOAD_DIR) || !fs.existsSync(localPath)) {
        throw new HttpError({ statusCode: 404, code: 'NOT_FOUND', message: 'File not found.' });
      }
      if (wantsJson) {
        const baseUrl = `${req.protocol}://${req.get('host') ?? ''}`;
        const url = `${baseUrl}/api/upload/private/${row.id}`;
        res.json({ ok: true, data: { url } });
      } else {
        res.sendFile(localPath, {
          headers: {
            'Content-Disposition': 'inline',
            'Content-Type': row.detected_mime ?? 'application/octet-stream',
            'X-Content-Type-Options': 'nosniff',
          },
        });
      }
      return;
    }
    const signedUrl = await createPrivateSignedUrl(
      row.bucket,
      row.storage_path,
      SIGNED_URL_EXPIRY_SECONDS,
    );
    if (wantsJson) {
      res.json({ ok: true, data: { url: signedUrl } });
    } else {
      res.redirect(302, signedUrl);
    }
  }),
);

export { uploadRouter };
