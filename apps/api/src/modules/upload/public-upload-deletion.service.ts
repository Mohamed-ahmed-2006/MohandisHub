import { env } from '../../config/env.js';
import { deleteLocalUploadBasenameIfExists } from '../../lib/local-upload-storage.js';
import { deleteObjectsFromBucket, UPLOADS_BUCKET } from '../../lib/supabase-storage.js';
import { HttpError } from '../../utils/http-error.js';

import { PublicUploadRepository, type PublicUploadObjectRow } from './public-upload.repository.js';

const LOCAL_PUBLIC_BUCKET = 'local';
const SUPABASE_PUBLIC_PREFIX = `/storage/v1/object/public/${UPLOADS_BUCKET}/`;

export type PublicUploadObject = {
  id: string;
  userId: string;
  bucket: string;
  storagePath: string;
  visibility: 'public' | 'private';
  state: 'planned' | 'active' | 'failed' | 'pending_delete' | 'deleted';
};

type PublicUploadRepositoryPort = {
  findById(id: string): Promise<PublicUploadObjectRow | PublicUploadObject | null>;
  findActiveByLocation(
    bucket: string,
    storagePath: string,
  ): Promise<PublicUploadObjectRow | PublicUploadObject | null>;
  claimDeletion(input: {
    uploadObjectId: string;
    actorId: string;
    allowAdmin: boolean;
    expectedBucket: string;
    expectedStoragePath: string;
  }): Promise<PublicUploadObjectRow | PublicUploadObject | null>;
  completeDeletion(uploadObjectId: string): Promise<void>;
  failDeletion(uploadObjectId: string, errorMessage: string): Promise<void>;
};

type PublicUploadStoragePort = {
  deleteLocal(basename: string): boolean;
  deleteSupabase(bucket: string, paths: string[]): Promise<void>;
};

type TrustedReference = { bucket: string; storagePath: string };

const toObject = (row: PublicUploadObjectRow | PublicUploadObject): PublicUploadObject =>
  'user_id' in row
    ? {
        id: row.id,
        userId: row.user_id,
        bucket: row.bucket,
        storagePath: row.storage_path,
        visibility: row.visibility,
        state: row.state,
      }
    : row;

const isSafeFlatObjectKey = (value: string): boolean =>
  value.length > 0 &&
  value !== '.' &&
  value !== '..' &&
  !value.includes('/') &&
  !value.includes('\\') &&
  !value.includes('\0') &&
  !value.includes('..');

function parseTrustedReference(
  referenceUrl: string,
  supabaseOrigin: string | null,
): TrustedReference | null {
  const raw = referenceUrl.trim();
  if (!raw || raw.includes('?') || raw.includes('#') || raw.includes('\\')) return null;
  // Reject encoded separators, traversal dots, and secondary encoding before
  // URL normalization gets a chance to hide them.
  if (/%(?:2e|2f|5c|25)/i.test(raw)) return null;

  if (raw.startsWith('/')) {
    const match = raw.match(/^\/uploads\/([^/]+)$/);
    if (!match) return null;
    try {
      const storagePath = decodeURIComponent(match[1]!);
      return isSafeFlatObjectKey(storagePath) ? { bucket: LOCAL_PUBLIC_BUCKET, storagePath } : null;
    } catch {
      return null;
    }
  }

  if (!supabaseOrigin) return null;
  try {
    const parsed = new URL(raw);
    if (
      parsed.origin !== supabaseOrigin ||
      parsed.username ||
      parsed.password ||
      !parsed.pathname.startsWith(SUPABASE_PUBLIC_PREFIX)
    ) {
      return null;
    }
    const encodedPath = parsed.pathname.slice(SUPABASE_PUBLIC_PREFIX.length);
    const storagePath = decodeURIComponent(encodedPath);
    return isSafeFlatObjectKey(storagePath) ? { bucket: UPLOADS_BUCKET, storagePath } : null;
  } catch {
    return null;
  }
}

const untrustedReference = (): HttpError =>
  new HttpError({
    statusCode: 400,
    code: 'UNTRUSTED_PUBLIC_UPLOAD_REFERENCE',
    message: 'The media reference does not match an owned public upload.',
  });

export class PublicUploadDeletionService {
  constructor(
    private readonly repository: PublicUploadRepositoryPort = new PublicUploadRepository(),
    private readonly storage: PublicUploadStoragePort = {
      deleteLocal: deleteLocalUploadBasenameIfExists,
      deleteSupabase: deleteObjectsFromBucket,
    },
    private readonly config: { supabaseOrigin: string | null } = {
      supabaseOrigin: env.SUPABASE_URL ? new URL(env.SUPABASE_URL).origin : null,
    },
  ) {}

  async deleteById(input: {
    uploadObjectId: string;
    actorId: string;
    allowAdmin: boolean;
    expectedLocation?: TrustedReference;
  }): Promise<{ filesRemoved: number }> {
    const found = await this.repository.findById(input.uploadObjectId);
    if (!found) {
      throw new HttpError({
        statusCode: 404,
        code: 'PUBLIC_UPLOAD_NOT_FOUND',
        message: 'Public upload not found.',
      });
    }
    const row = toObject(found);
    if (row.userId !== input.actorId && !input.allowAdmin) {
      throw new HttpError({
        statusCode: 403,
        code: 'PUBLIC_UPLOAD_FORBIDDEN',
        message: 'You cannot delete this public upload.',
      });
    }
    if (
      row.visibility !== 'public' ||
      row.state !== 'active' ||
      ![UPLOADS_BUCKET, LOCAL_PUBLIC_BUCKET].includes(row.bucket) ||
      !isSafeFlatObjectKey(row.storagePath) ||
      (input.expectedLocation != null &&
        (row.bucket !== input.expectedLocation.bucket ||
          row.storagePath !== input.expectedLocation.storagePath))
    ) {
      throw untrustedReference();
    }

    const claimed = await this.repository.claimDeletion({
      uploadObjectId: row.id,
      actorId: input.actorId,
      allowAdmin: input.allowAdmin,
      expectedBucket: row.bucket,
      expectedStoragePath: row.storagePath,
    });
    if (!claimed) throw untrustedReference();
    const trusted = toObject(claimed);

    try {
      let filesRemoved = 0;
      if (trusted.bucket === LOCAL_PUBLIC_BUCKET) {
        filesRemoved = this.storage.deleteLocal(trusted.storagePath) ? 1 : 0;
      } else {
        await this.storage.deleteSupabase(UPLOADS_BUCKET, [trusted.storagePath]);
        filesRemoved = 1;
      }
      await this.repository.completeDeletion(trusted.id);
      return { filesRemoved };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown storage deletion failure';
      await this.repository.failDeletion(trusted.id, message);
      throw error;
    }
  }

  async deleteTrustedReference(input: {
    referenceUrl: string;
    expectedOwnerId: string;
    actorId: string;
    allowAdmin: boolean;
  }): Promise<{ filesRemoved: number }> {
    const location = parseTrustedReference(input.referenceUrl, this.config.supabaseOrigin);
    if (!location) throw untrustedReference();
    const found = await this.repository.findActiveByLocation(location.bucket, location.storagePath);
    if (!found || toObject(found).userId !== input.expectedOwnerId) throw untrustedReference();

    return this.deleteById({
      uploadObjectId: toObject(found).id,
      actorId: input.actorId,
      allowAdmin: input.allowAdmin,
      expectedLocation: location,
    });
  }
}
