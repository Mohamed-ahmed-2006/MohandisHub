-- ============================================================================
-- Schema reconciliation — objects present in the live database but absent from
-- the repository migration history
-- ----------------------------------------------------------------------------
-- PROVENANCE: mixed. Each section below states its own source. Read it.
--
-- Background
-- ----------
-- This project has had THREE migration mechanisms:
--
--   1. `public.schema_migrations`  — versions 001-006 (Mar 2026), custom runner
--   2. `public._migrations`        — versions 008-024 (Mar 2026), custom runner
--   3. `supabase_migrations.schema_migrations` — the current Supabase CLI
--
-- Commit 5e04ed1 ("Move DB migrations to supabase & add ship script", 2026-03-09)
-- moved the numbered files into supabase/migrations with timestamp prefixes. That
-- move was NOT a faithful copy: several files were rewritten, and at least one
-- (006_future_proof_fields.sql) was dropped entirely. The live database still
-- carries everything the old runners applied, so the schema works — but a clean
-- replay of supabase/migrations does not reproduce it.
--
-- This migration closes that gap so `node scripts/migration-replay-check.mjs`
-- passes. It is idempotent and safe to run against the live database, where every
-- statement is expected to be a no-op.
--
-- NOT ADDRESSED HERE (deliberately):
--   * `public._migrations` and `public.schema_migrations` — the two dead custom
--     trackers. They are historical infrastructure, not application schema, and
--     recreating them in a fresh database would be misleading. The replay check
--     excludes them explicitly.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Recovered from git: apps/api/src/db/migrations/006_future_proof_fields.sql
-- ---------------------------------------------------------------------------
-- SOURCE: ORIGINAL SQL, recovered verbatim from commit dee2bfd. This file was
-- applied to the database (public.schema_migrations lists '006_future_proof_fields')
-- but was never carried into supabase/migrations by the 5e04ed1 move.
--
-- Only two changes were made to the recovered text: ADD COLUMN / CREATE INDEX
-- were made IF NOT EXISTS so this is safe to replay, and the inline CHECK
-- constraints were given explicit names matching what the live database already
-- has (business_profiles_profile_visibility_check, etc.).

-- 1a. Users — global preferences, legal, and safety
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS locale            VARCHAR(10) DEFAULT 'en',
  ADD COLUMN IF NOT EXISTS time_zone         VARCHAR(50) DEFAULT 'Africa/Cairo',
  ADD COLUMN IF NOT EXISTS last_login_at     TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS accepted_terms_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS terms_version     VARCHAR(20),
  ADD COLUMN IF NOT EXISTS deleted_at        TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_users_deleted_at
  ON public.users (deleted_at) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_users_last_login_at
  ON public.users (last_login_at DESC NULLS LAST);

COMMENT ON COLUMN public.users.locale IS 'Preferred UI locale (e.g. en, ar)';
COMMENT ON COLUMN public.users.time_zone IS 'IANA timezone (e.g. Africa/Cairo)';
COMMENT ON COLUMN public.users.last_login_at IS 'Last successful login';
COMMENT ON COLUMN public.users.accepted_terms_at IS 'When user accepted current terms';
COMMENT ON COLUMN public.users.terms_version IS 'Version of terms accepted (e.g. 2024-01)';
COMMENT ON COLUMN public.users.deleted_at IS 'Soft delete; NULL = active';

-- 1b. Customer profiles — notification channels
ALTER TABLE public.customer_profiles
  ADD COLUMN IF NOT EXISTS notification_preferences JSONB NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN public.customer_profiles.notification_preferences
  IS 'Channels: email, push, sms, marketing';

-- 1c. Expert profiles — visibility and onboarding funnel
ALTER TABLE public.expert_profiles
  ADD COLUMN IF NOT EXISTS profile_visibility   VARCHAR(20) NOT NULL DEFAULT 'public',
  ADD COLUMN IF NOT EXISTS profile_completed_at TIMESTAMPTZ;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'expert_profiles_profile_visibility_check'
      AND conrelid = 'public.expert_profiles'::regclass
  ) THEN
    ALTER TABLE public.expert_profiles
      ADD CONSTRAINT expert_profiles_profile_visibility_check
      CHECK (profile_visibility IN ('public', 'unlisted', 'draft'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_expert_profiles_visibility
  ON public.expert_profiles (profile_visibility);
CREATE INDEX IF NOT EXISTS idx_expert_profiles_completed_at
  ON public.expert_profiles (profile_completed_at) WHERE profile_completed_at IS NOT NULL;

COMMENT ON COLUMN public.expert_profiles.profile_visibility IS 'public | unlisted | draft';
COMMENT ON COLUMN public.expert_profiles.profile_completed_at IS 'When onboarding was completed';

-- 1d. Business profiles — same visibility and completion
ALTER TABLE public.business_profiles
  ADD COLUMN IF NOT EXISTS profile_visibility   VARCHAR(20) NOT NULL DEFAULT 'public',
  ADD COLUMN IF NOT EXISTS profile_completed_at TIMESTAMPTZ;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'business_profiles_profile_visibility_check'
      AND conrelid = 'public.business_profiles'::regclass
  ) THEN
    ALTER TABLE public.business_profiles
      ADD CONSTRAINT business_profiles_profile_visibility_check
      CHECK (profile_visibility IN ('public', 'unlisted', 'draft'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_business_profiles_visibility
  ON public.business_profiles (profile_visibility);
CREATE INDEX IF NOT EXISTS idx_business_profiles_completed_at
  ON public.business_profiles (profile_completed_at) WHERE profile_completed_at IS NOT NULL;

COMMENT ON COLUMN public.business_profiles.profile_visibility IS 'public | unlisted | draft';
COMMENT ON COLUMN public.business_profiles.profile_completed_at IS 'When onboarding was completed';

-- 1e. Plans — admin-managed tiers
CREATE INDEX IF NOT EXISTS idx_plans_active_sort
  ON public.plans (is_active, sort_order) WHERE is_active = true;

-- 1f. users.plan_id — index and delete behaviour from the original 005_plans.sql
-- The rewritten 20240101000005 declares `plan_id UUID REFERENCES plans(id)` with
-- no delete action (so PostgreSQL defaults to NO ACTION) and no index. The
-- original migration used ON DELETE RESTRICT, which is what live has: a plan
-- that users are still on must not be deletable.
CREATE INDEX IF NOT EXISTS idx_users_plan_id ON public.users (plan_id);

-- The original migration seeded a fixed-UUID 'free' plan and used it as the
-- column default, so every user always has a plan. The rewrite dropped both the
-- default and the NOT NULL. Restore them, backfilling any NULL first.
-- The canonical free plan is seeded by 20240101000005; this only guards the case
-- where it is somehow absent, and must not collide on either key.
INSERT INTO public.plans (id, slug, name)
VALUES ('00000000-0000-4000-a000-000000000001'::uuid, 'free', 'Free')
ON CONFLICT DO NOTHING;

UPDATE public.users
SET plan_id = '00000000-0000-4000-a000-000000000001'::uuid
WHERE plan_id IS NULL;

ALTER TABLE public.users
  ALTER COLUMN plan_id SET DEFAULT '00000000-0000-4000-a000-000000000001'::uuid;
ALTER TABLE public.users ALTER COLUMN plan_id SET NOT NULL;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'users_plan_id_fkey'
      AND conrelid = 'public.users'::regclass
      AND confdeltype <> 'r'   -- 'r' = RESTRICT
  ) THEN
    ALTER TABLE public.users DROP CONSTRAINT users_plan_id_fkey;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'users_plan_id_fkey' AND conrelid = 'public.users'::regclass
  ) THEN
    ALTER TABLE public.users
      ADD CONSTRAINT users_plan_id_fkey
      FOREIGN KEY (plan_id) REFERENCES public.plans(id) ON DELETE RESTRICT;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 2. Column-definition drift introduced by the 5e04ed1 rewrite
-- ---------------------------------------------------------------------------
-- SOURCE: LIVE SCHEMA is authoritative here. The rewritten repo files produce
-- slightly different definitions from the original numbered migrations that
-- actually built the database:
--
--   plans.slug / plans.name  repo adds DEFAULT 'free' / 'Free'; live has none.
--                            The original 005_plans.sql had no defaults — the
--                            defaults were invented during the rewrite.
--   plans.sort_order         repo (20240101000007) makes it nullable; live is
--                            NOT NULL DEFAULT 0, per 006_future_proof_fields.
--
-- These are aligned to LIVE, because live is what the application has always
-- run against and what its queries assume.
ALTER TABLE public.plans ALTER COLUMN slug DROP DEFAULT;
ALTER TABLE public.plans ALTER COLUMN name DROP DEFAULT;

UPDATE public.plans SET sort_order = 0 WHERE sort_order IS NULL;
ALTER TABLE public.plans ALTER COLUMN sort_order SET DEFAULT 0;
ALTER TABLE public.plans ALTER COLUMN sort_order SET NOT NULL;

-- ---------------------------------------------------------------------------
-- 3. media_assets — schema created by application code, never by a migration
-- ---------------------------------------------------------------------------
-- SOURCE: ORIGINAL DDL, copied verbatim from
-- apps/api/src/modules/media/media.repository.ts (`ensureTable`), which issues
-- CREATE TABLE IF NOT EXISTS on every call. The table therefore exists in every
-- environment the API has ever run against, but no migration declares it.
--
-- AMBIGUITY FLAGGED (not resolved here): `usage_type` is free TEXT with no CHECK
-- constraint and no enumeration anywhere in the schema. The permitted values are
-- whatever the application happens to pass. Deriving that set is a behavioural
-- question, not a schema one, so no constraint is invented here.
--
-- FOLLOW-UP: runtime DDL in a repository is a latent hazard — it makes schema
-- depend on code execution order and hides changes from review. Once this
-- migration is applied everywhere, `ensureTable` should be removed. That is a
-- code change, deliberately not bundled into this migration.
CREATE TABLE IF NOT EXISTS public.media_assets (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title      TEXT NOT NULL,
  alt_text   TEXT NULL,
  usage_type TEXT NOT NULL,
  image_url  TEXT NOT NULL,
  active     BOOLEAN NOT NULL DEFAULT true,
  sort_order INTEGER NOT NULL DEFAULT 0,
  starts_at  TIMESTAMPTZ NULL,
  ends_at    TIMESTAMPTZ NULL,
  created_by UUID NULL REFERENCES public.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_media_assets_usage_active_sort
  ON public.media_assets (usage_type, active, sort_order, created_at DESC);
