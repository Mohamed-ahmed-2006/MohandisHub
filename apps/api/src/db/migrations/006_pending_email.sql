-- ============================================================================
-- MohandisHub — v006: Add pending email change support
-- ============================================================================

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS pending_email          VARCHAR(255),
  ADD COLUMN IF NOT EXISTS pending_email_token    VARCHAR(255),
  ADD COLUMN IF NOT EXISTS pending_email_expires  TIMESTAMPTZ;
