import fs from 'node:fs';
import path from 'node:path';

import type { ApiSuccessBody } from '@mohandishub/shared';
import { Router } from 'express';
import multer from 'multer';

import { authenticate } from '../../middleware/authenticate.js';
import { requireEmailVerified } from '../../middleware/require-email-verified.js';
import { asyncHandler } from '../../utils/async-handler.js';
import { HttpError } from '../../utils/http-error.js';
import { SettingsService } from '../settings/settings.service.js';

const settingsService = new SettingsService();

const UPLOAD_DIR = path.resolve(process.cwd(), 'uploads');
if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname);
    const name = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}${ext}`;
    cb(null, name);
  },
});

const ALLOWED_MIME = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'application/pdf',
  'video/mp4',
  'video/webm',
];
const MAX_SIZE = 50 * 1024 * 1024; // 50 MB for video

const upload = multer({
  storage,
  limits: { fileSize: MAX_SIZE },
  fileFilter: (_req, file, cb) => {
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
  },
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
  asyncHandler((req, res) => {
    if (!req.file) {
      throw new HttpError({ statusCode: 400, code: 'NO_FILE', message: 'No file provided.' });
    }
    const fileUrl = `/uploads/${req.file.filename}`;
    const response: ApiSuccessBody<{ url: string; filename: string; originalName: string }> = {
      ok: true,
      data: { url: fileUrl, filename: req.file.filename, originalName: req.file.originalname },
    };
    res.status(201).json(response);
  }),
);

export { uploadRouter };
