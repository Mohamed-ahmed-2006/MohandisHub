-- ============================================================================
-- MohandisHub — v003: Add date_of_birth to users
-- Enforces minimum age of 20 years at the database level
-- ============================================================================

-- NOTE: 20240101000001_auth_schema.sql already creates this column, so a clean
-- replay used to abort here with "column date_of_birth already exists". The two
-- files disagree because the 2026-03-09 move rewrote them independently. Made
-- idempotent rather than deleted, so the migration's intent (the age constraint)
-- stays visible in history.
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS date_of_birth DATE;

-- Database-level constraint: user must be at least 20 years old
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'chk_users_min_age' AND conrelid = 'public.users'::regclass
  ) THEN
    ALTER TABLE users
      ADD CONSTRAINT chk_users_min_age
        CHECK (date_of_birth IS NULL OR date_of_birth <= (CURRENT_DATE - INTERVAL '20 years'));
  END IF;
END $$;
