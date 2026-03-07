import fs from 'node:fs';
import path from 'node:path';

import type { ApiSuccessBody } from '@mohandishub/shared';
import { Router } from 'express';
import multer from 'multer';

import { authenticate } from '../../middleware/authenticate.js';
import { requireEmailVerified } from '../../middleware/require-email-verified.js';
import { asyncHandler } from '../../utils/async-handler.js';
import { HttpError } from '../../utils/http-error.js';

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

const ALLOWED_MIME = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
const MAX_SIZE = 10 * 1024 * 1024; // 10 MB

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
          message: 'Only JPEG, PNG, WebP, and PDF files are allowed.',
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
  upload.single('file'),
  asyncHandler((req, res) => {
    if (!req.file) {
      throw new HttpError({ statusCode: 400, code: 'NO_FILE', message: 'No file provided.' });
    }
    const fileUrl = `/uploads/${req.file.filename}`;
    const response: ApiSuccessBody<{ url: string; filename: string }> = {
      ok: true,
      data: { url: fileUrl, filename: req.file.filename },
    };
    res.status(201).json(response);
  }),
);

export { uploadRouter };
