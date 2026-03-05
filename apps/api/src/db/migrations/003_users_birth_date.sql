-- ============================================================================
-- MohandisHub — v003: Add date_of_birth to users (if not already present)
-- Enforces minimum age of 20 years at the database level
-- ============================================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'users' AND column_name = 'date_of_birth'
  ) THEN
    ALTER TABLE users ADD COLUMN date_of_birth DATE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'chk_users_min_age' AND conrelid = 'public.users'::regclass
  ) THEN
    ALTER TABLE users
      ADD CONSTRAINT chk_users_min_age
      CHECK (date_of_birth IS NULL OR date_of_birth <= (CURRENT_DATE - INTERVAL '20 years'));
  END IF;
END $$;
