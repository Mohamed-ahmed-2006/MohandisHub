-- ============================================================================
-- MohandisHub - Plan subscriptions (period + expiry)
-- ============================================================================

CREATE TABLE IF NOT EXISTS plan_subscriptions (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  plan_id    UUID NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
  starts_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  ends_at    TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_plan_subscriptions_user_id ON plan_subscriptions(user_id);
CREATE INDEX IF NOT EXISTS idx_plan_subscriptions_ends_at ON plan_subscriptions(ends_at);

COMMENT ON TABLE plan_subscriptions IS 'User plan subscription periods; current plan is the one with ends_at > now() (latest by ends_at).';
