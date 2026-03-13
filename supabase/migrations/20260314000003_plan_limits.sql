-- ============================================================================
-- MohandisHub - Plan limits (feature toggles and numeric limits per plan)
-- ============================================================================

ALTER TABLE plans
  ADD COLUMN IF NOT EXISTS plan_limits JSONB NOT NULL DEFAULT '{}';

COMMENT ON COLUMN plans.plan_limits IS 'Structured limits and flags: max_services, max_needs, max_jobs, can_priority_listing, bids_visible_to_customer (all|top_n|premium_first), etc.';
