-- ============================================================================
-- MohandisHub - v048: craftsman role and craftsman profiles
-- ============================================================================

-- --------------------------------------------------------------------------
-- 1) Allow craftsman as a primary role
-- --------------------------------------------------------------------------
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_primary_role_check;
ALTER TABLE users
  ADD CONSTRAINT users_primary_role_check
  CHECK (primary_role IN ('customer', 'expert', 'business', 'craftsman'));

-- --------------------------------------------------------------------------
-- 2) Individual provider profile for craftsmen
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS craftsman_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID UNIQUE NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  trade VARCHAR(150),
  title VARCHAR(200),
  headline VARCHAR(300),
  bio TEXT,
  specializations TEXT[] NOT NULL DEFAULT '{}',
  years_of_experience SMALLINT,
  hourly_rate NUMERIC(10, 2),
  city VARCHAR(100),
  country VARCHAR(100) NOT NULL DEFAULT 'Egypt',
  availability_status VARCHAR(20) NOT NULL DEFAULT 'available'
    CHECK (availability_status IN ('available', 'busy', 'offline')),
  workshop_name VARCHAR(200),
  workshop_address TEXT,
  workshop_latitude NUMERIC(9, 6),
  workshop_longitude NUMERIC(9, 6),
  verification_status VARCHAR(20) NOT NULL DEFAULT 'unverified'
    CHECK (verification_status IN ('unverified', 'pending', 'under_review', 'verified', 'rejected')),
  verified_at TIMESTAMPTZ,
  identity_verified BOOLEAN NOT NULL DEFAULT false,
  identity_verification_method VARCHAR(20)
    CHECK (identity_verification_method IS NULL OR identity_verification_method IN ('didit', 'manual')),
  payout_currency VARCHAR(20),
  payout_address TEXT,
  payout_extra_id VARCHAR(255),
  payout_updated_at TIMESTAMPTZ,
  onboarding_completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_craftsman_profiles_verification
  ON craftsman_profiles (verification_status);
CREATE INDEX IF NOT EXISTS idx_craftsman_profiles_specializations
  ON craftsman_profiles USING GIN (specializations);
CREATE INDEX IF NOT EXISTS idx_craftsman_profiles_payout_currency
  ON craftsman_profiles (payout_currency);

COMMENT ON TABLE craftsman_profiles IS 'Individual trade-service providers such as mechanics, plumbers, welders, and blacksmiths.';
COMMENT ON COLUMN craftsman_profiles.workshop_address IS 'Private workshop address. Public views should expose only city/area level location.';

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_proc WHERE proname = 'trigger_set_updated_at'
  ) AND NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'set_craftsman_profiles_updated_at'
      AND tgrelid = 'craftsman_profiles'::regclass
  ) THEN
    CREATE TRIGGER set_craftsman_profiles_updated_at
      BEFORE UPDATE ON craftsman_profiles
      FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();
  END IF;
END $$;

-- --------------------------------------------------------------------------
-- 3) Allow reviews for craftsmen
-- --------------------------------------------------------------------------
ALTER TABLE reviews DROP CONSTRAINT IF EXISTS reviews_target_type_check;
ALTER TABLE reviews
  ADD CONSTRAINT reviews_target_type_check
  CHECK (target_type IN ('expert', 'business', 'craftsman', 'customer'));
