-- ============================================================================
-- MohandisHub — v007: Expand plans table with pricing, billing, and features
-- ============================================================================

ALTER TABLE plans
  ADD COLUMN IF NOT EXISTS description    TEXT,
  ADD COLUMN IF NOT EXISTS price          NUMERIC(10,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS currency       VARCHAR(3)    NOT NULL DEFAULT 'EGP',
  ADD COLUMN IF NOT EXISTS billing_cycle  VARCHAR(20)   DEFAULT 'monthly'
    CHECK (billing_cycle IN ('monthly', 'quarterly', 'yearly', 'one_time')),
  ADD COLUMN IF NOT EXISTS duration_days  INTEGER,
  ADD COLUMN IF NOT EXISTS trial_days     INTEGER       DEFAULT 0,
  ADD COLUMN IF NOT EXISTS max_services   INTEGER,
  ADD COLUMN IF NOT EXISTS max_projects   INTEGER,
  ADD COLUMN IF NOT EXISTS features       JSONB         DEFAULT '[]',
  ADD COLUMN IF NOT EXISTS is_active      BOOLEAN       NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS sort_order     SMALLINT      DEFAULT 0,
  ADD COLUMN IF NOT EXISTS updated_at     TIMESTAMPTZ   NOT NULL DEFAULT now();

CREATE TRIGGER set_plans_updated_at
  BEFORE UPDATE ON plans
  FOR EACH ROW
  EXECUTE FUNCTION trigger_set_updated_at();
