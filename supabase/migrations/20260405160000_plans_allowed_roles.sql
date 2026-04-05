-- ============================================================================
-- MohandisHub — Plans: which primary roles may see and subscribe to each plan
-- ============================================================================

ALTER TABLE plans
  ADD COLUMN IF NOT EXISTS allowed_roles TEXT[] NOT NULL DEFAULT ARRAY['customer', 'expert', 'business', 'craftsman']::text[];

COMMENT ON COLUMN plans.allowed_roles IS 'Primary roles that may list and subscribe to this plan; enforced in API.';

UPDATE plans
SET allowed_roles = ARRAY['customer', 'expert', 'business', 'craftsman']::text[]
WHERE allowed_roles IS NULL OR cardinality(allowed_roles) = 0;
