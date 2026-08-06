import { getPool } from '../../db/pool.js';

export type PublicUploadObjectRow = {
  id: string;
  user_id: string;
  bucket: string;
  storage_path: string;
  visibility: 'public' | 'private';
  state: 'planned' | 'active' | 'failed' | 'pending_delete' | 'deleted';
};

export class PublicUploadRepository {
  async insertActive(input: {
    userId: string;
    bucket: string;
    storagePath: string;
    originalName: string;
    detectedMime: string;
    sizeBytes: number;
    sha256: string;
  }): Promise<PublicUploadObjectRow> {
    const { rows } = await getPool().query<PublicUploadObjectRow>(
      `INSERT INTO upload_objects (
         user_id, bucket, storage_path, visibility, original_name,
         detected_mime, size_bytes, sha256, state, activated_at
       )
       VALUES ($1, $2, $3, 'public', $4, $5, $6, $7, 'active', now())
       RETURNING id, user_id, bucket, storage_path, visibility, state`,
      [
        input.userId,
        input.bucket,
        input.storagePath,
        input.originalName,
        input.detectedMime,
        input.sizeBytes,
        input.sha256,
      ],
    );
    return rows[0]!;
  }

  async findById(id: string): Promise<PublicUploadObjectRow | null> {
    const { rows } = await getPool().query<PublicUploadObjectRow>(
      `SELECT id, user_id, bucket, storage_path, visibility, state
         FROM upload_objects
        WHERE id = $1`,
      [id],
    );
    return rows[0] ?? null;
  }

  async findActiveByLocation(
    bucket: string,
    storagePath: string,
  ): Promise<PublicUploadObjectRow | null> {
    const { rows } = await getPool().query<PublicUploadObjectRow>(
      `SELECT id, user_id, bucket, storage_path, visibility, state
         FROM upload_objects
        WHERE bucket = $1
          AND storage_path = $2
          AND visibility = 'public'
          AND state = 'active'`,
      [bucket, storagePath],
    );
    return rows[0] ?? null;
  }

  async claimDeletion(input: {
    uploadObjectId: string;
    actorId: string;
    allowAdmin: boolean;
    expectedBucket: string;
    expectedStoragePath: string;
  }): Promise<PublicUploadObjectRow | null> {
    const pool = getPool();
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const { rows } = await client.query<PublicUploadObjectRow>(
        `SELECT id, user_id, bucket, storage_path, visibility, state
           FROM upload_objects
          WHERE id = $1
          FOR UPDATE`,
        [input.uploadObjectId],
      );
      const row = rows[0];
      if (
        !row ||
        row.visibility !== 'public' ||
        row.state !== 'active' ||
        row.bucket !== input.expectedBucket ||
        row.storage_path !== input.expectedStoragePath ||
        (row.user_id !== input.actorId && !input.allowAdmin)
      ) {
        await client.query('ROLLBACK');
        return null;
      }

      const { rows: claimedRows } = await client.query<PublicUploadObjectRow>(
        `UPDATE upload_objects
            SET state = 'pending_delete', updated_at = now()
          WHERE id = $1
          RETURNING id, user_id, bucket, storage_path, visibility, state`,
        [row.id],
      );
      await client.query(
        `INSERT INTO storage_deletion_jobs (upload_object_id, state, attempts, next_attempt_at)
         VALUES ($1, 'processing', 1, now())
         ON CONFLICT (upload_object_id) DO UPDATE
           SET state = 'processing',
               attempts = storage_deletion_jobs.attempts + 1,
               next_attempt_at = now(),
               last_error = NULL,
               updated_at = now()`,
        [row.id],
      );
      await client.query('COMMIT');
      return claimedRows[0] ?? null;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async completeDeletion(uploadObjectId: string): Promise<void> {
    await this.finishDeletion(uploadObjectId, null);
  }

  async failDeletion(uploadObjectId: string, errorMessage: string): Promise<void> {
    await this.finishDeletion(uploadObjectId, errorMessage);
  }

  private async finishDeletion(uploadObjectId: string, errorMessage: string | null): Promise<void> {
    const pool = getPool();
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      if (errorMessage == null) {
        await client.query(
          `UPDATE upload_objects SET state = 'deleted', updated_at = now() WHERE id = $1`,
          [uploadObjectId],
        );
        await client.query(
          `UPDATE storage_deletion_jobs
              SET state = 'completed', last_error = NULL, updated_at = now()
            WHERE upload_object_id = $1`,
          [uploadObjectId],
        );
      } else {
        await client.query(
          `UPDATE upload_objects SET state = 'active', updated_at = now() WHERE id = $1`,
          [uploadObjectId],
        );
        await client.query(
          `UPDATE storage_deletion_jobs
              SET state = 'failed', last_error = $2, updated_at = now()
            WHERE upload_object_id = $1`,
          [uploadObjectId, errorMessage.slice(0, 2000)],
        );
      }
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
}
