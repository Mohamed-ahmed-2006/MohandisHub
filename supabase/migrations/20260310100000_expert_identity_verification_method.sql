-- Add identity_verification_method to expert_profiles so we can tell how identity was verified:
-- 'didit' = KYC via Didit (or other provider in verification_requests), 'manual' = admin-reviewed identity_documents
ALTER TABLE expert_profiles
  ADD COLUMN IF NOT EXISTS identity_verification_method VARCHAR(20) NULL
    CHECK (identity_verification_method IS NULL OR identity_verification_method IN ('didit', 'manual'));

COMMENT ON COLUMN expert_profiles.identity_verification_method IS 'How identity was verified: didit = external KYC (Didit), manual = admin-reviewed identity_documents';
