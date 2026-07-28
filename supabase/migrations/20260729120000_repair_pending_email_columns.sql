-- ============================================================================
-- Repair: restore the pending-email-change columns
-- ----------------------------------------------------------------------------
-- LIVE DEFECT, found by scripts/migration-replay-check.mjs.
--
-- `users.pending_email`, `pending_email_token` and `pending_email_expires` are
-- read and written by the application:
--
--   apps/api/src/modules/auth/auth.repository.ts     (set + consume the token)
--   apps/api/src/modules/admin/admin.repository.ts   (clear on admin edit)
--
-- but they DO NOT EXIST in the database. Any email-change attempt fails with
-- `column "pending_email" does not exist`. The feature has been broken for as
-- long as the deployment has existed.
--
-- Root cause: a version-number collision between this project's two migration
-- schemes. The original custom runner applied `006_future_proof_fields`
-- (recorded in public.schema_migrations). When the project moved to the Supabase
-- CLI, version `20240101000006` — a DIFFERENT migration, 006_pending_email — was
-- marked as already applied during baselining. The CLI therefore skipped it
-- forever, and nothing noticed because no test exercises the email-change path
-- against a real database.
--
-- Note `pending_email_attempts` DOES exist: it was added later by
-- 20260610123000_cap_pending_email_attempts.sql, which ran normally. So the
-- table currently has the attempt counter for a feature whose other three
-- columns are missing — a good illustration of why the counter alone was not
-- enough to reveal the gap.
--
-- Non-destructive and idempotent: adds columns only.
-- ============================================================================

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS pending_email         VARCHAR(255),
  ADD COLUMN IF NOT EXISTS pending_email_token   VARCHAR(255),
  ADD COLUMN IF NOT EXISTS pending_email_expires TIMESTAMPTZ;

-- The token is looked up directly during confirmation, so it needs an index and
-- must not be reusable across users.
CREATE UNIQUE INDEX IF NOT EXISTS uq_users_pending_email_token
  ON public.users (pending_email_token)
  WHERE pending_email_token IS NOT NULL;

COMMENT ON COLUMN public.users.pending_email IS 'Requested new email, unconfirmed';
COMMENT ON COLUMN public.users.pending_email_token IS 'Single-use confirmation token';
COMMENT ON COLUMN public.users.pending_email_expires IS 'Expiry for the confirmation token';

-- Verify, rather than trusting that the ADD COLUMN above did what it says.
DO $$
DECLARE
  missing INTEGER;
BEGIN
  SELECT count(*) INTO missing
  FROM (VALUES ('pending_email'), ('pending_email_token'), ('pending_email_expires')) AS required(col)
  WHERE NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'users' AND column_name = required.col
  );

  IF missing > 0 THEN
    RAISE EXCEPTION 'pending-email repair failed: % column(s) still missing', missing;
  END IF;

  RAISE NOTICE 'Pending-email columns present; email change is functional again.';
END $$;
