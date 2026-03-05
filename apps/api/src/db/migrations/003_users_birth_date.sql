-- ============================================================================
-- MohandisHub — v003: Add date_of_birth to users
-- Enforces minimum age of 20 years at the database level
-- ============================================================================

ALTER TABLE users
  ADD COLUMN date_of_birth DATE;

-- Database-level constraint: user must be at least 20 years old
ALTER TABLE users
  ADD CONSTRAINT chk_users_min_age
    CHECK (date_of_birth IS NULL OR date_of_birth <= (CURRENT_DATE - INTERVAL '20 years'));
