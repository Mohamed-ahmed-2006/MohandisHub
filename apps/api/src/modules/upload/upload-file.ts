import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';

import { fileTypeFromBuffer } from 'file-type';

import { HttpError } from '../../utils/http-error.js';

export const ALLOWED_UPLOAD_MIMES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'application/pdf',
  'video/mp4',
  'video/webm',
] as const;

export const ADVERTISEMENT_IMAGE_MIMES = ['image/jpeg', 'image/png', 'image/webp'] as const;

export type DetectedUpload = {
  buffer: Buffer;
  mime: (typeof ALLOWED_UPLOAD_MIMES)[number];
  extension: 'jpg' | 'png' | 'webp' | 'pdf' | 'mp4' | 'webm';
  size: number;
  sha256: string;
};

const MIME_EXTENSION: Record<DetectedUpload['mime'], DetectedUpload['extension']> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'application/pdf': 'pdf',
  'video/mp4': 'mp4',
  'video/webm': 'webm',
};

export async function detectAndValidateUpload(
  file: Express.Multer.File,
  allowedMimes: readonly string[] = ALLOWED_UPLOAD_MIMES,
): Promise<DetectedUpload> {
  const buffer = file.buffer ?? (file.path ? await fs.readFile(file.path) : null);
  if (!buffer || buffer.length === 0) {
    throw new HttpError({
      statusCode: 400,
      code: 'INVALID_FILE_TYPE',
      message: 'The uploaded file is empty or unreadable.',
    });
  }

  const detected = await fileTypeFromBuffer(buffer);
  const mime = detected?.mime;
  if (
    !mime ||
    !ALLOWED_UPLOAD_MIMES.includes(mime as DetectedUpload['mime']) ||
    !allowedMimes.includes(mime) ||
    file.mimetype.toLowerCase() !== mime
  ) {
    throw new HttpError({
      statusCode: 400,
      code: 'INVALID_FILE_TYPE',
      message: 'The file contents do not match an allowed file type.',
    });
  }

  const safeMime = mime as DetectedUpload['mime'];
  return {
    buffer,
    mime: safeMime,
    extension: MIME_EXTENSION[safeMime],
    size: buffer.length,
    sha256: createHash('sha256').update(buffer).digest('hex'),
  };
}

export async function removeTemporaryUpload(file: Express.Multer.File | undefined): Promise<void> {
  if (!file?.path) return;
  try {
    await fs.unlink(file.path);
  } catch {
    // A missing temporary file is already clean.
  }
}
