-- ============================================================================
-- MohandisHub - v017: Repair plans schema for admin CRUD compatibility
-- ============================================================================

-- Ensure the table exists for environments that skipped old migrations.
CREATE TABLE IF NOT EXISTS plans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug VARCHAR(50) UNIQUE NOT NULL DEFAULT 'free',
  name VARCHAR(100) NOT NULL DEFAULT 'Free',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE plans
  ADD COLUMN IF NOT EXISTS description TEXT,
  ADD COLUMN IF NOT EXISTS price NUMERIC(10, 2),
  ADD COLUMN IF NOT EXISTS currency VARCHAR(3),
  ADD COLUMN IF NOT EXISTS billing_cycle VARCHAR(20),
  ADD COLUMN IF NOT EXISTS duration_days INTEGER,
  ADD COLUMN IF NOT EXISTS trial_days INTEGER,
  ADD COLUMN IF NOT EXISTS max_services INTEGER,
  ADD COLUMN IF NOT EXISTS max_projects INTEGER,
  ADD COLUMN IF NOT EXISTS features JSONB,
  ADD COLUMN IF NOT EXISTS is_active BOOLEAN,
  ADD COLUMN IF NOT EXISTS sort_order SMALLINT,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ;

-- Normalize nullable legacy rows and restore defaults/constraints expected by API.
ALTER TABLE plans ALTER COLUMN price SET DEFAULT 0;
UPDATE plans SET price = 0 WHERE price IS NULL;
ALTER TABLE plans ALTER COLUMN price SET NOT NULL;

ALTER TABLE plans ALTER COLUMN currency SET DEFAULT 'EGP';
UPDATE plans SET currency = 'EGP' WHERE currency IS NULL;
ALTER TABLE plans ALTER COLUMN currency SET NOT NULL;

ALTER TABLE plans ALTER COLUMN billing_cycle SET DEFAULT 'monthly';
UPDATE plans
SET billing_cycle = 'monthly'
WHERE billing_cycle IS NULL
  OR billing_cycle NOT IN ('monthly', 'quarterly', 'yearly', 'one_time');

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'plans_billing_cycle_check'
      AND conrelid = 'plans'::regclass
  ) THEN
    ALTER TABLE plans
      ADD CONSTRAINT plans_billing_cycle_check
      CHECK (billing_cycle IN ('monthly', 'quarterly', 'yearly', 'one_time'));
  END IF;
END $$;

ALTER TABLE plans ALTER COLUMN trial_days SET DEFAULT 0;
UPDATE plans SET trial_days = 0 WHERE trial_days IS NULL;

ALTER TABLE plans ALTER COLUMN features SET DEFAULT '[]'::jsonb;
UPDATE plans SET features = '[]'::jsonb WHERE features IS NULL;

ALTER TABLE plans ALTER COLUMN is_active SET DEFAULT true;
UPDATE plans SET is_active = true WHERE is_active IS NULL;
ALTER TABLE plans ALTER COLUMN is_active SET NOT NULL;

ALTER TABLE plans ALTER COLUMN sort_order SET DEFAULT 0;
UPDATE plans SET sort_order = 0 WHERE sort_order IS NULL;

ALTER TABLE plans ALTER COLUMN updated_at SET DEFAULT now();
UPDATE plans SET updated_at = COALESCE(updated_at, created_at, now()) WHERE updated_at IS NULL;
ALTER TABLE plans ALTER COLUMN updated_at SET NOT NULL;

-- Keep updated_at in sync for admin edits.
CREATE OR REPLACE FUNCTION trigger_set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_trigger
    WHERE tgname = 'set_plans_updated_at'
      AND tgrelid = 'plans'::regclass
  ) THEN
    CREATE TRIGGER set_plans_updated_at
      BEFORE UPDATE ON plans
      FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();
  END IF;
END $$;

-- Ensure at least one baseline plan exists.
INSERT INTO plans (slug, name, price, currency, billing_cycle, trial_days, features, is_active, sort_order, updated_at)
VALUES ('free', 'Free', 0, 'EGP', 'monthly', 0, '[]'::jsonb, true, 0, now())
ON CONFLICT (slug) DO NOTHING;
