-- ============================================================================
-- MohandisHub — v006: Future-proof fields before scaling
--
-- Adds fields that are much easier to add now than to retrofit later:
--   - Users: locale, timezone, last login, terms acceptance, soft delete
--   - Customer: notification preferences
--   - Expert/Business: profile visibility, profile completed (onboarding)
--   - Plans: description, is_active, sort_order (for admin-managed plans)
-- ============================================================================

-- --------------------------------------------------------------------------
-- 1. Users — global preferences, legal, and safety
-- --------------------------------------------------------------------------

-- Preferred UI language (en/ar); avoids relying only on Accept-Language
ALTER TABLE users
  ADD COLUMN locale VARCHAR(10) DEFAULT 'en';

-- IANA timezone for scheduling, notifications, "last active"
ALTER TABLE users
  ADD COLUMN time_zone VARCHAR(50) DEFAULT 'Africa/Cairo';

-- Last successful login (security, analytics, "last active")
ALTER TABLE users
  ADD COLUMN last_login_at TIMESTAMPTZ;

-- Legal: when user accepted Terms & Conditions (you already link T&C at signup)
ALTER TABLE users
  ADD COLUMN accepted_terms_at TIMESTAMPTZ,
  ADD COLUMN terms_version VARCHAR(20);

-- Soft delete: GDPR, restore, audit. Queries should filter: WHERE deleted_at IS NULL
ALTER TABLE users
  ADD COLUMN deleted_at TIMESTAMPTZ;

CREATE INDEX idx_users_deleted_at ON users (deleted_at) WHERE deleted_at IS NULL;
CREATE INDEX idx_users_last_login_at ON users (last_login_at DESC NULLS LAST);

COMMENT ON COLUMN users.locale IS 'Preferred UI locale (e.g. en, ar)';
COMMENT ON COLUMN users.time_zone IS 'IANA timezone (e.g. Africa/Cairo)';
COMMENT ON COLUMN users.last_login_at IS 'Last successful login';
COMMENT ON COLUMN users.accepted_terms_at IS 'When user accepted current terms';
COMMENT ON COLUMN users.terms_version IS 'Version of terms accepted (e.g. 2024-01)';
COMMENT ON COLUMN users.deleted_at IS 'Soft delete; NULL = active';

-- --------------------------------------------------------------------------
-- 2. Customer profiles — notifications
-- --------------------------------------------------------------------------

-- e.g. { "email": true, "push": true, "sms": false, "marketing": false }
ALTER TABLE customer_profiles
  ADD COLUMN notification_preferences JSONB NOT NULL DEFAULT '{}';

COMMENT ON COLUMN customer_profiles.notification_preferences IS 'Channels: email, push, sms, marketing';

-- --------------------------------------------------------------------------
-- 3. Expert profiles — visibility and onboarding funnel
-- --------------------------------------------------------------------------

-- public = listed in search; unlisted = by link only; draft = not visible
ALTER TABLE expert_profiles
  ADD COLUMN profile_visibility VARCHAR(20) NOT NULL DEFAULT 'public'
    CHECK (profile_visibility IN ('public', 'unlisted', 'draft')),
  ADD COLUMN profile_completed_at TIMESTAMPTZ;

CREATE INDEX idx_expert_profiles_visibility ON expert_profiles (profile_visibility);
CREATE INDEX idx_expert_profiles_completed_at ON expert_profiles (profile_completed_at) WHERE profile_completed_at IS NOT NULL;

COMMENT ON COLUMN expert_profiles.profile_visibility IS 'public | unlisted | draft';
COMMENT ON COLUMN expert_profiles.profile_completed_at IS 'When onboarding was completed';

-- --------------------------------------------------------------------------
-- 4. Business profiles — same visibility and completion
-- --------------------------------------------------------------------------

ALTER TABLE business_profiles
  ADD COLUMN profile_visibility VARCHAR(20) NOT NULL DEFAULT 'public'
    CHECK (profile_visibility IN ('public', 'unlisted', 'draft')),
  ADD COLUMN profile_completed_at TIMESTAMPTZ;

CREATE INDEX idx_business_profiles_visibility ON business_profiles (profile_visibility);
CREATE INDEX idx_business_profiles_completed_at ON business_profiles (profile_completed_at) WHERE profile_completed_at IS NOT NULL;

COMMENT ON COLUMN business_profiles.profile_visibility IS 'public | unlisted | draft';
COMMENT ON COLUMN business_profiles.profile_completed_at IS 'When onboarding was completed';

-- --------------------------------------------------------------------------
-- 5. Plans — for when admin adds paid / tiered plans
-- --------------------------------------------------------------------------

ALTER TABLE plans
  ADD COLUMN description TEXT,
  ADD COLUMN is_active BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN sort_order SMALLINT NOT NULL DEFAULT 0;

CREATE INDEX idx_plans_active_sort ON plans (is_active, sort_order) WHERE is_active = true;

COMMENT ON COLUMN plans.description IS 'Display description for plan';
COMMENT ON COLUMN plans.is_active IS 'Hide from selection without deleting';
COMMENT ON COLUMN plans.sort_order IS 'Display order in admin and signup';
