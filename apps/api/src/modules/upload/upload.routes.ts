import fs from 'node:fs';
import path from 'node:path';

import type { ApiSuccessBody } from '@mohandishub/shared';
import { Router } from 'express';
import multer from 'multer';

import {
  createPrivateSignedUrl,
  isSupabaseStorageConfigured,
  uploadToSupabase,
  uploadToSupabasePrivate,
} from '../../lib/supabase-storage.js';
import { authenticate } from '../../middleware/authenticate.js';
import { requireEmailVerified } from '../../middleware/require-email-verified.js';
import { asyncHandler } from '../../utils/async-handler.js';
import { HttpError } from '../../utils/http-error.js';
import { SettingsService } from '../settings/settings.service.js';

import {
  findPrivateUploadById,
  insertPrivateUpload,
  isJobOwnerOfApplicationWithCv,
} from './upload.repository.js';

const settingsService = new SettingsService();
const PRIVATE_BUCKET = 'verification-docs';

const UPLOAD_DIR = path.resolve(process.cwd(), 'uploads');
if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

const ALLOWED_MIME = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'application/pdf',
  'video/mp4',
  'video/webm',
];
const MAX_SIZE = 50 * 1024 * 1024; // 50 MB for video

const fileFilter = (
  _req: Express.Request,
  file: Express.Multer.File,
  cb: (err: Error | null, accept?: boolean) => void,
): void => {
  if (ALLOWED_MIME.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(
      new HttpError({
        statusCode: 400,
        code: 'INVALID_FILE_TYPE',
        message: 'Only JPEG, PNG, WebP, PDF, MP4, and WebM are allowed.',
      }) as unknown as Error,
    );
  }
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
  limits: { fileSize: MAX_SIZE },
  fileFilter,
});

const uploadRouter = Router();

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
  upload.single('file'),
  asyncHandler(async (req, res) => {
    if (!req.file) {
      throw new HttpError({ statusCode: 400, code: 'NO_FILE', message: 'No file provided.' });
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
    if (!isSupabaseStorageConfigured()) {
      throw new HttpError({
        statusCode: 503,
        code: 'PRIVATE_UPLOAD_UNAVAILABLE',
        message: 'Private uploads require Supabase Storage.',
      });
    }
    next();
  }),
  upload.single('file'),
  asyncHandler(async (req, res) => {
    if (!req.file) {
      throw new HttpError({ statusCode: 400, code: 'NO_FILE', message: 'No file provided.' });
    }
    const user = req.user!;
    if (!req.file.buffer) {
      throw new HttpError({
        statusCode: 400,
        code: 'PRIVATE_UPLOAD_REQUIRES_SUPABASE',
        message: 'Private uploads are not supported with local storage.',
      });
    }
    const { path: storagePath } = await uploadToSupabasePrivate(
      req.file.buffer,
      req.file.originalname,
      req.file.mimetype,
    );
    const row = await insertPrivateUpload({
      storagePath,
      bucket: PRIVATE_BUCKET,
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

uploadRouter.get(
  '/private/:id',
  authenticate,
  asyncHandler(async (req, res) => {
    const row = await findPrivateUploadById(req.params.id!);
    if (!row) {
      throw new HttpError({ statusCode: 404, code: 'NOT_FOUND', message: 'File not found.' });
    }
    const user = req.user!;
    if (row.user_id !== user.id && !user.isAdmin) {
      const jobOwner = await isJobOwnerOfApplicationWithCv(user.id, row.id);
      if (!jobOwner) {
        throw new HttpError({ statusCode: 403, code: 'FORBIDDEN', message: 'Access denied.' });
      }
    }
    const signedUrl = await createPrivateSignedUrl(
      row.bucket,
      row.storage_path,
      SIGNED_URL_EXPIRY_SECONDS,
    );
    const wantsJson = req.accepts('application/json');
    if (wantsJson) {
      res.json({ ok: true, data: { url: signedUrl } });
    } else {
      res.redirect(302, signedUrl);
    }
  }),
);

export { uploadRouter };
