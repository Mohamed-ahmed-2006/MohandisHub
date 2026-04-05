-- Metered plan usage per user per feature per billing/calendar window (distinct from concurrent inventory caps).

CREATE TABLE IF NOT EXISTS user_plan_usage_counters (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  feature_key text NOT NULL,
  period_start timestamptz NOT NULL,
  period_end timestamptz NOT NULL,
  count integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT user_plan_usage_counters_user_feature_period UNIQUE (user_id, feature_key, period_start)
);

CREATE INDEX IF NOT EXISTS idx_user_plan_usage_counters_user_feature
  ON user_plan_usage_counters (user_id, feature_key);

COMMENT ON TABLE user_plan_usage_counters IS 'Counts metered plan actions per user per time window (see plans.plan_limits.usageQuotas).';
