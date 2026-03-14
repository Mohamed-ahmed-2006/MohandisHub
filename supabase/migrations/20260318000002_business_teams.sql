-- Team accounts for businesses: one business can have multiple members
CREATE TABLE IF NOT EXISTS business_teams (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name        VARCHAR(200),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS business_members (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id    UUID NOT NULL REFERENCES business_teams(id) ON DELETE CASCADE,
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role       VARCHAR(30) NOT NULL DEFAULT 'member' CHECK (role IN ('owner', 'manager', 'member', 'viewer')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(team_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_business_teams_business ON business_teams(business_id);
CREATE INDEX IF NOT EXISTS idx_business_members_team ON business_members(team_id);
CREATE INDEX IF NOT EXISTS idx_business_members_user ON business_members(user_id);

COMMENT ON TABLE business_teams IS 'Business team (one per business for now)';
COMMENT ON TABLE business_members IS 'Team members with roles';
