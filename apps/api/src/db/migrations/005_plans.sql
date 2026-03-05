-- ============================================================================
-- Plans — subscription/tier at user level (default: free)
-- Other plans can be added manually by admin later.
-- ============================================================================

CREATE TABLE plans (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug       VARCHAR(50) UNIQUE NOT NULL,
  name       VARCHAR(100) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Seed the default free plan (fixed UUID so we can use it as DEFAULT for users)
INSERT INTO plans (id, slug, name)
VALUES ('00000000-0000-4000-a000-000000000001'::uuid, 'free', 'Free');

-- Add plan to users; default new and existing rows to free
ALTER TABLE users
  ADD COLUMN plan_id UUID NOT NULL
    DEFAULT '00000000-0000-4000-a000-000000000001'::uuid
    REFERENCES plans(id) ON DELETE RESTRICT;

CREATE INDEX idx_users_plan_id ON users (plan_id);

COMMENT ON TABLE plans IS 'User subscription plans; free is default, others added by admin later';
