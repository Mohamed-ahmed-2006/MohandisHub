import fs from 'node:fs';
import path from 'node:path';

import type { ApiSuccessBody } from '@mohandishub/shared';
import type { Request } from 'express';
import { Router } from 'express';
import multer from 'multer';

import { env } from '../../config/env.js';
import {
  createPrivateSignedUrl,
  isSupabaseStorageConfigured,
  uploadToSupabase,
  uploadToSupabasePrivate,
} from '../../lib/supabase-storage.js';
import { authenticate } from '../../middleware/authenticate.js';
import { loadAdminFromDb } from '../../middleware/load-admin-from-db.js';
import { requireEmailVerified } from '../../middleware/require-email-verified.js';
import { hasAdminPermission } from '../../middleware/require-role.js';
import { asyncHandler } from '../../utils/async-handler.js';
import { HttpError } from '../../utils/http-error.js';
import { SettingsService } from '../settings/settings.service.js';

import {
  findPrivateUploadById,
  insertPrivateUpload,
  isJobOwnerOfApplicationWithCv,
  isMoneyProofVisibleToUser,
  isResolutionCaseEvidence,
  isResolutionEvidenceVisibleToUser,
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

const ALLOWED_MIME = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'application/pdf',
  'video/mp4',
  'video/webm',
];
const DEFAULT_MAX_SIZE = 50 * 1024 * 1024; // 50 MB for video

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
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname);
    const name = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}${ext}`;
    cb(null, name);
  },
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
    const settingsRow = await settingsService.getRawRow();
    const customMimes = parseSettingsMimes(settingsRow?.public_upload_allowed_mimes);
    const effectiveMimes = customMimes ?? ALLOWED_MIME;
    if (!effectiveMimes.includes(req.file.mimetype)) {
      throw new HttpError({
        statusCode: 400,
        code: 'INVALID_FILE_TYPE',
        message: 'This file type is not allowed.',
      });
    }
    const maxBytes = Math.min(
      env.PUBLIC_UPLOAD_MAX_BYTES_CEILING,
      settingsRow?.max_public_upload_bytes ?? DEFAULT_MAX_SIZE,
    );
    if (req.file.size > maxBytes) {
      throw new HttpError({
        statusCode: 413,
        code: 'FILE_TOO_LARGE',
        message: `File exceeds maximum size of ${maxBytes} bytes.`,
      });
    }
    let fileUrl: string;
    let filename: string;
    if (isSupabaseStorageConfigured() && req.file.buffer) {
      const result = await uploadToSupabase(
        req.file.buffer,
        req.file.originalname,
        req.file.mimetype,
      );
      fileUrl = result.url;
      filename = result.path;
    } else {
      const diskFile = req.file as Express.Multer.File & { filename?: string };
      filename = diskFile.filename ?? req.file.originalname;
      fileUrl = `/uploads/${filename}`;
    }
    const response: ApiSuccessBody<{ url: string; filename: string; originalName: string }> = {
      ok: true,
      data: { url: fileUrl, filename, originalName: req.file.originalname },
    };
    res.status(201).json(response);
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
    const settingsRow = await settingsService.getRawRow();
    const customMimes = parseSettingsMimes(settingsRow?.public_upload_allowed_mimes);
    const effectiveMimes = customMimes ?? ALLOWED_MIME;
    if (!effectiveMimes.includes(req.file.mimetype)) {
      throw new HttpError({
        statusCode: 400,
        code: 'INVALID_FILE_TYPE',
        message: 'This file type is not allowed.',
      });
    }
    const maxBytes = Math.min(
      env.PUBLIC_UPLOAD_MAX_BYTES_CEILING,
      settingsRow?.max_public_upload_bytes ?? DEFAULT_MAX_SIZE,
    );
    if (req.file.size > maxBytes) {
      throw new HttpError({
        statusCode: 413,
        code: 'FILE_TOO_LARGE',
        message: `File exceeds maximum size of ${maxBytes} bytes.`,
      });
    }
    const user = req.user!;
    const useSupabase = isSupabaseStorageConfigured();
    let storagePath: string;
    let bucket: string;
    if (useSupabase && req.file.buffer) {
      const result = await uploadToSupabasePrivate(
        req.file.buffer,
        req.file.originalname,
        req.file.mimetype,
      );
      storagePath = result.path;
      bucket = PRIVATE_BUCKET;
    } else {
      const diskFile = req.file as Express.Multer.File & { path?: string; filename?: string };
      const srcPath = diskFile.path;
      const filename =
        diskFile.filename ??
        `${Date.now()}-${Math.random().toString(36).slice(2, 10)}${path.extname(req.file.originalname)}`;
      if (!srcPath || !filename) {
        throw new HttpError({
          statusCode: 400,
          code: 'NO_FILE',
          message: 'File data missing.',
        });
      }
      const destPath = path.join(UPLOAD_PRIVATE_DIR, filename);
      fs.renameSync(srcPath, destPath);
      storagePath = `private/${filename}`;
      bucket = PRIVATE_BUCKET_LOCAL;
    }
    const row = await insertPrivateUpload({
      storagePath,
      bucket,
      userId: user.id,
      originalName: req.file.originalname,
    });
    const url = `/api/upload/private/${row.id}`;
    const response: ApiSuccessBody<{ url: string; filename: string; originalName: string }> = {
      ok: true,
      data: { url, filename: row.id, originalName: req.file.originalname },
    };
    res.status(201).json(response);
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
      // Every arm is a server-side question about what this file is attached
      // to. Nothing the client sends — not a case id, not a dispute id —
      // participates in the decision.
      const allowed =
        (await isResolutionEvidenceVisibleToUser(user.id, row.id)) ||
        (hasAdminPermission(user, 'manage_support') && (await isResolutionCaseEvidence(row.id))) ||
        (await isJobOwnerOfApplicationWithCv(user.id, row.id)) ||
        (await isMoneyProofVisibleToUser(user.id, row.id));
      if (!allowed) {
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
        res.sendFile(localPath, { headers: { 'Content-Disposition': 'inline' } });
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
