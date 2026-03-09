-- ============================================================================
-- MohandisHub — v014: is_admin flag + plans backfill
--
-- 1. Add is_admin boolean so users can be admin + customer/expert/business
-- 2. Migrate existing primary_role='admin' users to is_admin=true, primary_role='customer'
-- 3. Update primary_role CHECK to exclude 'admin' (admin is now a flag)
-- 4. Backfill plans table: ensure free plan has defaults for 007 columns
-- ============================================================================

-- --------------------------------------------------------------------------
-- 1. Add is_admin to users
-- --------------------------------------------------------------------------
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS is_admin BOOLEAN NOT NULL DEFAULT false;

-- --------------------------------------------------------------------------
-- 2. Migrate existing admin users: set is_admin=true, primary_role='customer'
-- --------------------------------------------------------------------------
UPDATE users
SET is_admin = true, primary_role = 'customer'
WHERE primary_role = 'admin';

-- --------------------------------------------------------------------------
-- 3. Update primary_role CHECK to exclude 'admin'
-- --------------------------------------------------------------------------
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_primary_role_check;
ALTER TABLE users
  ADD CONSTRAINT users_primary_role_check
  CHECK (primary_role IN ('customer', 'expert', 'business'));

-- --------------------------------------------------------------------------
-- 4. Backfill plans: ensure free plan has 007 columns (only if 007 was run)
-- --------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'plans' AND column_name = 'price') THEN
    UPDATE plans
    SET
      price = COALESCE(price, 0),
      currency = COALESCE(currency, 'EGP'),
      billing_cycle = COALESCE(billing_cycle, 'monthly'),
      is_active = COALESCE(is_active, true),
      sort_order = COALESCE(sort_order, 0),
      updated_at = COALESCE(updated_at, created_at, now())
    WHERE slug = 'free'
      AND (price IS NULL OR currency IS NULL OR billing_cycle IS NULL OR is_active IS NULL OR sort_order IS NULL OR updated_at IS NULL);
  END IF;
END $$;
