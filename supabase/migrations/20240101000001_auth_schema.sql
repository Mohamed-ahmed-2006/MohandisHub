-- ============================================================================
-- MohandisHub Auth Schema — v001
-- Designed for a Vezeeta-style engineering marketplace with 3 roles:
--   customer  → requests services / posts jobs
--   expert    → freelance engineer, requires identity verification
--   business  → company profile, requires business verification
-- ============================================================================

-- Enable pgcrypto for gen_random_uuid() if not already enabled
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- --------------------------------------------------------------------------
-- 1. Core users table — role-agnostic identity
-- --------------------------------------------------------------------------
CREATE TABLE users (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email           VARCHAR(255) UNIQUE NOT NULL,
  password_hash   VARCHAR(255) NOT NULL,
  phone           VARCHAR(20),
  display_name    VARCHAR(100) NOT NULL,
  avatar_url      TEXT,
  date_of_birth   DATE,
  primary_role    VARCHAR(20) NOT NULL
                    CHECK (primary_role IN ('customer', 'expert', 'business')),
  email_verified_at   TIMESTAMPTZ,
  phone_verified_at   TIMESTAMPTZ,
  is_active       BOOLEAN NOT NULL DEFAULT true,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_users_min_age
    CHECK (date_of_birth IS NULL OR date_of_birth <= (CURRENT_DATE - INTERVAL '20 years'))
);

CREATE INDEX idx_users_email ON users (email);
CREATE INDEX idx_users_primary_role ON users (primary_role);

-- --------------------------------------------------------------------------
-- 2. Refresh tokens — session management with token rotation
-- --------------------------------------------------------------------------
CREATE TABLE refresh_tokens (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash  VARCHAR(255) NOT NULL,           -- SHA-256 of the opaque token
  family_id   UUID NOT NULL,                   -- groups rotated tokens (detect reuse)
  device_info TEXT,
  ip_address  INET,
  expires_at  TIMESTAMPTZ NOT NULL,
  revoked_at  TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_refresh_tokens_user_id    ON refresh_tokens (user_id);
CREATE INDEX idx_refresh_tokens_token_hash ON refresh_tokens (token_hash);
CREATE INDEX idx_refresh_tokens_family_id  ON refresh_tokens (family_id);

-- --------------------------------------------------------------------------
-- 3. Customer profiles
-- --------------------------------------------------------------------------
CREATE TABLE customer_profiles (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID UNIQUE NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  address     TEXT,
  city        VARCHAR(100),
  country     VARCHAR(100) DEFAULT 'Egypt',
  preferences JSONB DEFAULT '{}',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- --------------------------------------------------------------------------
-- 4. Expert profiles — individual engineers / freelancers
-- --------------------------------------------------------------------------
CREATE TABLE expert_profiles (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id               UUID UNIQUE NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title                 VARCHAR(200),        -- e.g. "Senior Mechanical Engineer"
  bio                   TEXT,
  specializations       TEXT[] DEFAULT '{}',  -- e.g. {"mechanical","hvac","plumbing"}
  years_of_experience   SMALLINT,
  hourly_rate           NUMERIC(10, 2),
  city                  VARCHAR(100),
  country               VARCHAR(100) DEFAULT 'Egypt',
  availability_status   VARCHAR(20) DEFAULT 'available'
                          CHECK (availability_status IN ('available', 'busy', 'offline')),
  verification_status   VARCHAR(20) NOT NULL DEFAULT 'unverified'
                          CHECK (verification_status IN (
                            'unverified', 'pending', 'under_review', 'verified', 'rejected'
                          )),
  verified_at           TIMESTAMPTZ,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_expert_profiles_verification ON expert_profiles (verification_status);
CREATE INDEX idx_expert_profiles_specializations ON expert_profiles USING GIN (specializations);

-- --------------------------------------------------------------------------
-- 5. Business profiles — companies
-- --------------------------------------------------------------------------
CREATE TABLE business_profiles (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                 UUID UNIQUE NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  company_name            VARCHAR(200) NOT NULL,
  trade_license_number    VARCHAR(100),
  tax_id                  VARCHAR(100),
  industry                VARCHAR(100),
  company_size            VARCHAR(20)
                            CHECK (company_size IN ('1-10', '11-50', '51-200', '201-500', '500+')),
  website                 VARCHAR(255),
  city                    VARCHAR(100),
  country                 VARCHAR(100) DEFAULT 'Egypt',
  description             TEXT,
  verification_status     VARCHAR(20) NOT NULL DEFAULT 'unverified'
                            CHECK (verification_status IN (
                              'unverified', 'pending', 'under_review', 'verified', 'rejected'
                            )),
  verified_at             TIMESTAMPTZ,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_business_profiles_verification ON business_profiles (verification_status);

-- --------------------------------------------------------------------------
-- 6. Verification requests — audit trail for KYC / KYB
-- --------------------------------------------------------------------------
CREATE TABLE verification_requests (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id               UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider              VARCHAR(50) NOT NULL,          -- 'idenfy', 'manual', etc.
  provider_session_id   VARCHAR(255),                  -- external provider reference
  request_type          VARCHAR(20) NOT NULL
                          CHECK (request_type IN ('identity', 'business')),
  status                VARCHAR(20) NOT NULL DEFAULT 'initiated'
                          CHECK (status IN (
                            'initiated', 'submitted', 'approved', 'rejected', 'expired'
                          )),
  document_refs         JSONB DEFAULT '[]',            -- uploaded doc references
  provider_response     JSONB,                         -- raw provider callback data
  reviewer_notes        TEXT,
  reviewed_by           UUID REFERENCES users(id),     -- admin who reviewed (manual)
  expires_at            TIMESTAMPTZ,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_verification_user_id ON verification_requests (user_id);
CREATE INDEX idx_verification_status  ON verification_requests (status);

-- --------------------------------------------------------------------------
-- 7. Trigger: auto-update updated_at
-- --------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION trigger_set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER set_users_updated_at
  BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

CREATE TRIGGER set_customer_profiles_updated_at
  BEFORE UPDATE ON customer_profiles
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

CREATE TRIGGER set_expert_profiles_updated_at
  BEFORE UPDATE ON expert_profiles
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

CREATE TRIGGER set_business_profiles_updated_at
  BEFORE UPDATE ON business_profiles
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

CREATE TRIGGER set_verification_requests_updated_at
  BEFORE UPDATE ON verification_requests
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();
