-- ============================================================================
-- deposit_intent_idempotency
-- ----------------------------------------------------------------------------
-- RECOVERED MIGRATION — restored to version control on 2026-07-29.
--
-- This file was applied to the database but was missing from the repository.
-- The SQL below is the ORIGINAL text, recovered verbatim from
-- supabase_migrations.schema_migrations.statements (the statement list the
-- Supabase CLI recorded when it applied this migration). It is NOT a
-- reconstruction from the live schema.
--
-- Statements are re-joined in their recorded execution order. Only the
-- statement separator was re-added; no statement text was altered.
--
-- Applied version: 20260727091000
-- Statements:      6
-- ============================================================================

-- Persist checkout intent before contacting payment providers.

ALTER TABLE deposit_requests
  ADD COLUMN IF NOT EXISTS client_idempotency_key UUID,
  ADD COLUMN IF NOT EXISTS checkout_url TEXT,
  ADD COLUMN IF NOT EXISTS provider_requested_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS provider_responded_at TIMESTAMPTZ;

ALTER TABLE deposit_requests DROP CONSTRAINT IF EXISTS deposit_requests_status_check;

ALTER TABLE deposit_requests ADD CONSTRAINT deposit_requests_status_check CHECK (
  status IN (
    'initiating',
    'pending',
    'pending_fx',
    'paid',
    'expired',
    'failed',
    'cancelled',
    'pending_review',
    'rejected'
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_deposit_requests_user_provider_idempotency
  ON deposit_requests (user_id, provider, client_idempotency_key)
  WHERE client_idempotency_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_deposit_requests_stale_initiating
  ON deposit_requests (provider_requested_at)
  WHERE status IN ('initiating', 'pending_fx');

COMMENT ON COLUMN deposit_requests.client_idempotency_key IS
  'Client-provided or server-generated UUID used to prevent duplicate provider checkout creation.';
