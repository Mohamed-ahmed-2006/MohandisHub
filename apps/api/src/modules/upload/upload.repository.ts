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

/**
 * May this user open a file that was attached as case evidence?
 *
 * Both arms answer from the case, never from anything the client sent. The
 * reservation arm also closes a real gap: a dispute's counterparty could
 * already SEE the other side's evidence listed in the case file but could not
 * open it, because this route had no idea reservation disputes existed.
 */
export async function isResolutionEvidenceVisibleToUser(
  userId: string,
  uploadId: string,
): Promise<boolean> {
  const db = getPool();
  const { rows } = await db.query<{ allowed: boolean }>(
    `SELECT (
       EXISTS (
         SELECT 1
           FROM resolution_case_evidence e
           JOIN resolution_cases c ON c.id = e.case_id
          WHERE e.upload_id = $2
            AND (
              c.opened_by = $1
              OR (c.counterparty_id = $1 AND c.counterparty_access = true)
            )
       )
       OR EXISTS (
         SELECT 1
           FROM reservation_dispute_evidence de
           JOIN reservation_disputes d ON d.id = de.dispute_id
           JOIN reservations r ON r.id = d.reservation_id
          WHERE de.upload_id = $2
            AND (r.customer_id = $1 OR r.provider_id = $1)
       )
     ) AS allowed`,
    [userId, uploadId],
  );
  return rows[0]?.allowed === true;
}

/**
 * Is this upload case evidence at all?
 *
 * Used to scope support admins to case files. They must not inherit the blanket
 * private-upload read that verification and money admins hold, because that
 * bucket also holds identity documents.
 */
export async function isResolutionCaseEvidence(uploadId: string): Promise<boolean> {
  const db = getPool();
  const { rows } = await db.query<{ allowed: boolean }>(
    `SELECT (
       EXISTS (SELECT 1 FROM resolution_case_evidence WHERE upload_id = $1)
       OR EXISTS (SELECT 1 FROM reservation_dispute_evidence WHERE upload_id = $1)
     ) AS allowed`,
    [uploadId],
  );
  return rows[0]?.allowed === true;
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
