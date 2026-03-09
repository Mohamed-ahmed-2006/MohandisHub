-- ============================================================================
-- MohandisHub - Freelance hardening (single accepted winner invariants)
-- ============================================================================

-- Keep at most one accepted bid per need before adding the unique index.
WITH ranked_accepted_bids AS (
  SELECT
    b.id,
    ROW_NUMBER() OVER (
      PARTITION BY b.need_id
      ORDER BY
        (b.id = n.awarded_bid_id) DESC,
        ((b.payment_transaction_id IS NOT NULL) OR (b.paid_at IS NOT NULL)) DESC,
        b.updated_at DESC,
        b.created_at DESC,
        b.id DESC
    ) AS rn
  FROM bids b
  LEFT JOIN needs n ON n.id = b.need_id
  WHERE b.status = 'accepted'
)
UPDATE bids b
SET status = 'rejected',
    updated_at = now()
FROM ranked_accepted_bids r
WHERE b.id = r.id
  AND r.rn > 1;

-- Realign awarded_bid_id with the accepted bid, when present.
-- (CTE used because UPDATE...FROM LATERAL cannot reference the target table.)
WITH ranked_accepted AS (
  SELECT
    n.id AS need_id,
    (
      SELECT b.id
      FROM bids b
      WHERE b.need_id = n.id
        AND b.status = 'accepted'
      ORDER BY
        (b.id = n.awarded_bid_id) DESC,
        ((b.payment_transaction_id IS NOT NULL) OR (b.paid_at IS NOT NULL)) DESC,
        b.updated_at DESC,
        b.created_at DESC,
        b.id DESC
      LIMIT 1
    ) AS best_accepted_id
  FROM needs n
  WHERE n.awarded_bid_id IS NOT NULL
)
UPDATE needs n
SET awarded_bid_id = r.best_accepted_id,
    updated_at = now()
FROM ranked_accepted r
WHERE n.id = r.need_id
  AND n.awarded_bid_id IS DISTINCT FROM r.best_accepted_id;

UPDATE needs n
SET awarded_bid_id = NULL,
    updated_at = now()
WHERE n.awarded_bid_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM bids b
    WHERE b.id = n.awarded_bid_id
      AND b.status = 'accepted'
  );

CREATE UNIQUE INDEX IF NOT EXISTS uniq_bids_one_accepted_per_need
  ON bids(need_id)
  WHERE status = 'accepted';

-- Keep at most one accepted job application per job before adding the unique index.
WITH ranked_accepted_applications AS (
  SELECT
    a.id,
    ROW_NUMBER() OVER (
      PARTITION BY a.job_id
      ORDER BY
        EXISTS (
          SELECT 1
          FROM job_milestones m
          WHERE m.job_application_id = a.id
        ) DESC,
        a.updated_at DESC,
        a.created_at DESC,
        a.id DESC
    ) AS rn
  FROM job_applications a
  WHERE a.status = 'accepted'
)
UPDATE job_applications a
SET status = 'rejected',
    updated_at = now()
FROM ranked_accepted_applications r
WHERE a.id = r.id
  AND r.rn > 1;

CREATE UNIQUE INDEX IF NOT EXISTS uniq_job_applications_one_accepted_per_job
  ON job_applications(job_id)
  WHERE status = 'accepted';
