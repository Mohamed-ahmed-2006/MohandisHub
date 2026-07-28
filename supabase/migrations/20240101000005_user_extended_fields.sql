-- ============================================================================
-- MohandisHub — v005: Add missing columns referenced by auth repository
--
-- Adds: plans table, user columns for phone_code, nationality, plan_id,
--       accepted_terms_at, terms_version, deleted_at, last_login_at
-- ============================================================================

-- --------------------------------------------------------------------------
-- 1. Plans table — subscription / tier lookup
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS plans (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug        VARCHAR(50) UNIQUE NOT NULL DEFAULT 'free',
  name        VARCHAR(100) NOT NULL DEFAULT 'Free',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- The fixed UUID is load-bearing: users.plan_id defaults to it (see
-- 20260729110000_schema_reconciliation_from_live.sql), so every user lands on the
-- free plan without a lookup. The original apps/api/src/db/migrations/005_plans.sql
-- seeded this exact id; the 2026-03-09 rewrite dropped it and let the id be
-- random, which made a clean replay diverge from every existing database.
INSERT INTO plans (id, slug, name)
VALUES ('00000000-0000-4000-a000-000000000001'::uuid, 'free', 'Free')
ON CONFLICT (slug) DO NOTHING;

-- --------------------------------------------------------------------------
-- 2. Add missing columns to users table
-- --------------------------------------------------------------------------
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS phone_code        VARCHAR(6),
  ADD COLUMN IF NOT EXISTS nationality       VARCHAR(3),
  ADD COLUMN IF NOT EXISTS plan_id           UUID REFERENCES plans(id),
  ADD COLUMN IF NOT EXISTS accepted_terms_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS terms_version     VARCHAR(20),
  ADD COLUMN IF NOT EXISTS deleted_at        TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_login_at     TIMESTAMPTZ;
