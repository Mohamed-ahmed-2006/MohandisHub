import { getPool } from '../../db/pool.js';

export type UploadObjectRow = {
  id: string;
  user_id: string;
  bucket: string;
  storage_path: string;
  visibility: 'public' | 'private';
  original_name: string | null;
  detected_mime: string;
  size_bytes: string;
  sha256: string;
  state: 'planned' | 'active' | 'failed' | 'pending_delete' | 'deleted';
  created_at: Date;
  activated_at: Date | null;
  updated_at: Date;
};

export type PrivateUploadRow = {
  id: string;
  storage_path: string;
  bucket: string;
  user_id: string;
  original_name: string | null;
  upload_object_id: string | null;
  detected_mime: string | null;
  size_bytes: string | null;
  sha256: string | null;
  created_at: Date;
};

export type StorageDeletionJob = {
  id: string;
  upload_object_id: string;
  attempts: number;
  bucket: string;
  storage_path: string;
};

export async function createPlannedUploadObject(params: {
  userId: string;
  bucket: string;
  storagePath: string;
  visibility: 'public' | 'private';
  originalName: string;
  detectedMime: string;
  sizeBytes: number;
  sha256: string;
}): Promise<UploadObjectRow> {
  const db = getPool();
  const { rows } = await db.query<UploadObjectRow>(
    `INSERT INTO upload_objects (
       user_id, bucket, storage_path, visibility, original_name,
       detected_mime, size_bytes, sha256, state
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'planned')
     RETURNING *`,
    [
      params.userId,
      params.bucket,
      params.storagePath,
      params.visibility,
      params.originalName,
      params.detectedMime,
      params.sizeBytes,
      params.sha256,
    ],
  );
  return rows[0]!;
}

export async function activatePublicUploadObject(id: string): Promise<UploadObjectRow> {
  const db = getPool();
  const { rows } = await db.query<UploadObjectRow>(
    `UPDATE upload_objects
        SET state = 'active', activated_at = now(), updated_at = now()
      WHERE id = $1 AND state = 'planned'
      RETURNING *`,
    [id],
  );
  if (!rows[0]) throw new Error('Upload object could not be activated');
  return rows[0];
}

export async function markUploadObjectFailed(id: string, storageMayExist: boolean): Promise<void> {
  const db = getPool();
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `UPDATE upload_objects
          SET state = $2, updated_at = now()
        WHERE id = $1 AND state IN ('planned', 'active')`,
      [id, storageMayExist ? 'pending_delete' : 'failed'],
    );
    if (storageMayExist) {
      await client.query(
        `INSERT INTO storage_deletion_jobs (upload_object_id, state, next_attempt_at)
         VALUES ($1, 'pending', now())
         ON CONFLICT (upload_object_id) DO UPDATE
           SET state = 'pending', next_attempt_at = now(), updated_at = now()`,
        [id],
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

export async function leaseStorageDeletionJobs(limit = 20): Promise<StorageDeletionJob[]> {
  const db = getPool();
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `UPDATE storage_deletion_jobs
          SET state = 'pending', next_attempt_at = now(), updated_at = now()
        WHERE state = 'processing' AND updated_at < now() - interval '15 minutes'`,
    );
    const selected = await client.query<StorageDeletionJob>(
      `SELECT j.id, j.upload_object_id, j.attempts, o.bucket, o.storage_path
         FROM storage_deletion_jobs j
         JOIN upload_objects o ON o.id = j.upload_object_id
        WHERE j.state = 'pending' AND j.next_attempt_at <= now()
        ORDER BY j.next_attempt_at, j.created_at
        FOR UPDATE OF j SKIP LOCKED
        LIMIT $1`,
      [limit],
    );
    const ids = selected.rows.map((row) => row.id);
    if (ids.length > 0) {
      await client.query(
        `UPDATE storage_deletion_jobs
            SET state = 'processing', attempts = attempts + 1, updated_at = now()
          WHERE id = ANY($1::uuid[])`,
        [ids],
      );
    }
    await client.query('COMMIT');
    return selected.rows.map((row) => ({ ...row, attempts: row.attempts + 1 }));
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function completeStorageDeletionJob(job: StorageDeletionJob): Promise<void> {
  const db = getPool();
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `UPDATE upload_objects
          SET state = 'deleted', updated_at = now()
        WHERE id = $1`,
      [job.upload_object_id],
    );
    await client.query(
      `UPDATE storage_deletion_jobs
          SET state = 'completed', last_error = NULL, updated_at = now()
        WHERE id = $1`,
      [job.id],
    );
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function retryStorageDeletionJob(
  job: StorageDeletionJob,
  message: string,
  maxAttempts: number,
): Promise<boolean> {
  const terminal = job.attempts >= maxAttempts;
  const delaySeconds = Math.min(3600, 2 ** Math.min(job.attempts, 10) * 15);
  await getPool().query(
    `UPDATE storage_deletion_jobs
        SET state = $2,
            next_attempt_at = CASE WHEN $2 = 'failed' THEN next_attempt_at
              ELSE now() + ($3 * interval '1 second') END,
            last_error = $4,
            updated_at = now()
      WHERE id = $1`,
    [job.id, terminal ? 'failed' : 'pending', delaySeconds, message.slice(0, 500)],
  );
  return terminal;
}

export async function insertPrivateUpload(params: {
  uploadObjectId: string;
  storagePath: string;
  bucket: string;
  userId: string;
  originalName?: string | null;
  detectedMime: string;
  sizeBytes: number;
  sha256: string;
}): Promise<PrivateUploadRow> {
  const db = getPool();
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const activated = await client.query<UploadObjectRow>(
      `UPDATE upload_objects
          SET state = 'active', activated_at = now(), updated_at = now()
        WHERE id = $1 AND user_id = $2 AND state = 'planned'
        RETURNING *`,
      [params.uploadObjectId, params.userId],
    );
    if (!activated.rows[0]) throw new Error('Upload object could not be activated');
    const { rows } = await client.query<PrivateUploadRow>(
      `INSERT INTO private_uploads (
         storage_path, bucket, user_id, original_name, upload_object_id,
         detected_mime, size_bytes, sha256
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING *`,
      [
        params.storagePath,
        params.bucket,
        params.userId,
        params.originalName ?? null,
        params.uploadObjectId,
        params.detectedMime,
        params.sizeBytes,
        params.sha256,
      ],
    );
    await client.query('COMMIT');
    return rows[0]!;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function findPrivateUploadById(id: string): Promise<PrivateUploadRow | null> {
  const db = getPool();
  const { rows } = await db.query<PrivateUploadRow>(
    'SELECT * FROM private_uploads WHERE id = $1 LIMIT 1',
    [id],
  );
  return rows[0] ?? null;
}

/** True if the user is the business owner of a job that has an application with this upload as CV. */
export async function isJobOwnerOfApplicationWithCv(
  userId: string,
  uploadId: string,
): Promise<boolean> {
  const db = getPool();
  const prefix = `/api/upload/private/${uploadId}`;
  const { rows } = await db.query<{ n: number }>(
    `SELECT 1 AS n FROM job_applications a
     JOIN jobs j ON a.job_id = j.id
     WHERE j.business_id = $1 AND (a.cv_file_url = $2 OR a.cv_file_url LIKE $3)
     LIMIT 1`,
    [userId, prefix, `${prefix}%`],
  );
  return rows.length > 0;
}

export async function isMoneyProofVisibleToUser(
  userId: string,
  uploadId: string,
): Promise<boolean> {
  const db = getPool();
  const { rows } = await db.query<{ allowed: boolean }>(
    `SELECT (
       EXISTS (
         SELECT 1 FROM deposit_requests
          WHERE user_id = $1 AND proof_upload_id = $2
       )
       OR EXISTS (
         SELECT 1 FROM withdrawal_requests
          WHERE user_id = $1 AND admin_proof_upload_id = $2
       )
     ) AS allowed`,
    [userId, uploadId],
  );
  return rows[0]?.allowed === true;
}
