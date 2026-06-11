import { getPool } from '../../db/pool.js';

export type PrivateUploadRow = {
  id: string;
  storage_path: string;
  bucket: string;
  user_id: string;
  original_name: string | null;
  created_at: Date;
};

export async function insertPrivateUpload(params: {
  storagePath: string;
  bucket: string;
  userId: string;
  originalName?: string | null;
}): Promise<PrivateUploadRow> {
  const db = getPool();
  const { rows } = await db.query<PrivateUploadRow>(
    `INSERT INTO private_uploads (storage_path, bucket, user_id, original_name)
     VALUES ($1, $2, $3, $4)
     RETURNING *`,
    [params.storagePath, params.bucket, params.userId, params.originalName ?? null],
  );
  return rows[0]!;
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
