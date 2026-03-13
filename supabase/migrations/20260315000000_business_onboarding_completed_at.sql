-- Business onboarding completion milestone — backend-backed so completion is persisted
ALTER TABLE business_profiles
  ADD COLUMN IF NOT EXISTS onboarding_completed_at TIMESTAMPTZ;
