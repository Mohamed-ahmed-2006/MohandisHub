-- Cap confirmation attempts for pending email changes.
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS pending_email_attempts INTEGER NOT NULL DEFAULT 0;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'chk_users_pending_email_attempts_nonnegative'
      AND conrelid = 'public.users'::regclass
  ) THEN
    ALTER TABLE public.users
      ADD CONSTRAINT chk_users_pending_email_attempts_nonnegative
      CHECK (pending_email_attempts >= 0);
  END IF;
END $$;
