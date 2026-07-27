import fs from 'node:fs';
import path from 'node:path';

import type { NextFunction, Request, Response } from 'express';

import { getSupabaseStorageClient, isSupabaseStorageConfigured } from '../lib/supabase-storage.js';
import { asyncHandler } from '../utils/async-handler.js';
import { HttpError } from '../utils/http-error.js';

const UPLOAD_DIR = path.resolve(process.cwd(), 'uploads');

const extToMime: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.pdf': 'application/pdf',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
};

/**
 * Serves public upload files from local disk, or from Supabase `uploads` bucket if missing locally.
 * Render (and similar) have no persistent disk — legacy rows may still point at `/uploads/...` on the API host;
 * if the same object key exists in Supabase, this recovers the image without a DB migration.
 */
export const publicUploadsHandler = asyncHandler(
  async (req: Request, res: Response, next: NextFunction) => {
    const raw = req.params.filename ?? '';
    if (!raw || raw.includes('/') || raw.includes('\\')) {
      throw new HttpError({ statusCode: 400, code: 'BAD_REQUEST', message: 'Invalid file name.' });
    }
    const safe = path.basename(raw);
    if (safe !== raw || safe === '.' || safe === '..') {
      throw new HttpError({ statusCode: 400, code: 'BAD_REQUEST', message: 'Invalid file name.' });
    }

    const localPath = path.join(UPLOAD_DIR, safe);
    const resolvedLocal = path.resolve(localPath);
    const resolvedDir = path.resolve(UPLOAD_DIR);
    if (!resolvedLocal.startsWith(resolvedDir + path.sep) && resolvedLocal !== resolvedDir) {
      throw new HttpError({ statusCode: 400, code: 'BAD_REQUEST', message: 'Invalid file name.' });
    }

    if (fs.existsSync(localPath)) {
      const mime = extToMime[path.extname(safe).toLowerCase()] ?? 'application/octet-stream';
      res.sendFile(localPath, {
        headers: {
          'Content-Disposition': 'inline',
          'Content-Type': mime,
          'X-Content-Type-Options': 'nosniff',
        },
      });
      return;
    }

    if (isSupabaseStorageConfigured()) {
      const supabase = getSupabaseStorageClient();
      if (supabase) {
        const { data, error } = await supabase.storage.from('uploads').download(safe);
        if (!error && data) {
          const buf = Buffer.from(await data.arrayBuffer());
          const ext = path.extname(safe).toLowerCase();
          const mime = extToMime[ext] ?? 'application/octet-stream';
          res
            .type(mime)
            .set('Cache-Control', 'public, max-age=86400')
            .set('X-Content-Type-Options', 'nosniff')
            .send(buf);
          return;
        }
      }
    }

    next();
  },
);
