-- Phase 2-5 product value foundations: preferences, growth, teams, operations.

-- Notification preferences and Web Push subscriptions.
CREATE TABLE IF NOT EXISTS notification_preferences (
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  notification_type TEXT NOT NULL,
  channel TEXT NOT NULL CHECK (channel IN ('in_app', 'email', 'push')),
  enabled BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, notification_type, channel)
);

CREATE INDEX IF NOT EXISTS idx_notification_preferences_user
  ON notification_preferences(user_id);

CREATE TABLE IF NOT EXISTS push_subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  endpoint TEXT NOT NULL UNIQUE,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  user_agent TEXT,
  disabled_at TIMESTAMPTZ,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_push_subscriptions_user_active
  ON push_subscriptions(user_id, disabled_at);

-- Coupons: extend the existing stub instead of replacing it.
ALTER TABLE coupons ADD COLUMN IF NOT EXISTS target_surface TEXT NOT NULL DEFAULT 'all'
  CHECK (target_surface IN ('plan', 'service', 'ad', 'platform_fee', 'all'));
ALTER TABLE coupons ADD COLUMN IF NOT EXISTS funding_source TEXT
  CHECK (funding_source IN ('platform', 'provider', 'split'));
ALTER TABLE coupons ADD COLUMN IF NOT EXISTS provider_share_percent NUMERIC(5,2)
  CHECK (provider_share_percent IS NULL OR (provider_share_percent >= 0 AND provider_share_percent <= 100));
ALTER TABLE coupons ADD COLUMN IF NOT EXISTS min_spend NUMERIC(12,2)
  CHECK (min_spend IS NULL OR min_spend >= 0);
ALTER TABLE coupons ADD COLUMN IF NOT EXISTS max_discount NUMERIC(12,2)
  CHECK (max_discount IS NULL OR max_discount >= 0);
ALTER TABLE coupons ADD COLUMN IF NOT EXISTS max_uses_per_user INTEGER
  CHECK (max_uses_per_user IS NULL OR max_uses_per_user > 0);
ALTER TABLE coupons ADD COLUMN IF NOT EXISTS allowed_roles JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE coupons ADD COLUMN IF NOT EXISTS active BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_coupons_active_surface
  ON coupons(active, target_surface, valid_from, valid_until);

CREATE TABLE IF NOT EXISTS coupon_redemptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  coupon_id UUID NOT NULL REFERENCES coupons(id) ON DELETE RESTRICT,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  surface TEXT NOT NULL CHECK (surface IN ('plan', 'service', 'ad', 'platform_fee', 'all')),
  item_id UUID,
  provider_id UUID REFERENCES users(id) ON DELETE SET NULL,
  subtotal NUMERIC(12,2) NOT NULL CHECK (subtotal >= 0),
  discount_amount NUMERIC(12,2) NOT NULL CHECK (discount_amount >= 0),
  final_amount NUMERIC(12,2) NOT NULL CHECK (final_amount >= 0),
  currency TEXT NOT NULL DEFAULT 'EGP',
  funding_source TEXT NOT NULL CHECK (funding_source IN ('platform', 'provider', 'split')),
  status TEXT NOT NULL DEFAULT 'applied' CHECK (status IN ('applied', 'consumed', 'reversed')),
  source_reference TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  reversed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_coupon_redemptions_coupon_user
  ON coupon_redemptions(coupon_id, user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_coupon_redemptions_surface_item
  ON coupon_redemptions(surface, item_id);

-- Saved searches and recommendation consent/events.
CREATE TABLE IF NOT EXISTS saved_searches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('service', 'need')),
  name TEXT NOT NULL,
  filters JSONB NOT NULL DEFAULT '{}'::jsonb,
  locale TEXT NOT NULL DEFAULT 'en',
  result_count_snapshot INTEGER NOT NULL DEFAULT 0 CHECK (result_count_snapshot >= 0),
  last_viewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_saved_searches_user_kind
  ON saved_searches(user_id, kind, updated_at DESC);

CREATE TABLE IF NOT EXISTS recommendation_preferences (
  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  personalized_enabled BOOLEAN NOT NULL DEFAULT false,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS recommendation_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL CHECK (event_type IN ('service_view', 'search', 'saved_search', 'booking', 'rating')),
  service_id UUID REFERENCES services(id) ON DELETE SET NULL,
  category_id UUID REFERENCES service_categories(id) ON DELETE SET NULL,
  city TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_recommendation_events_user_created
  ON recommendation_events(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_recommendation_events_category_city
  ON recommendation_events(category_id, city, created_at DESC);

-- Business teams: keep existing tables, add roles, invites, and audit log.
CREATE TABLE IF NOT EXISTS business_team_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id UUID NOT NULL REFERENCES business_teams(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  role_key TEXT NOT NULL,
  built_in BOOLEAN NOT NULL DEFAULT false,
  permissions JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(team_id, role_key)
);

ALTER TABLE business_members ADD COLUMN IF NOT EXISTS role_id UUID REFERENCES business_team_roles(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_business_team_roles_team
  ON business_team_roles(team_id);
CREATE INDEX IF NOT EXISTS idx_business_members_role
  ON business_members(role_id);

CREATE TABLE IF NOT EXISTS business_team_invites (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id UUID NOT NULL REFERENCES business_teams(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  role_id UUID NOT NULL REFERENCES business_team_roles(id) ON DELETE RESTRICT,
  token_hash TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'revoked', 'expired')),
  invited_by UUID REFERENCES users(id) ON DELETE SET NULL,
  expires_at TIMESTAMPTZ NOT NULL DEFAULT now() + INTERVAL '7 days',
  accepted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_business_team_invites_team_status
  ON business_team_invites(team_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_business_team_invites_email_status
  ON business_team_invites(lower(email), status);

CREATE TABLE IF NOT EXISTS business_team_audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id UUID NOT NULL REFERENCES business_teams(id) ON DELETE CASCADE,
  actor_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id UUID,
  detail JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_business_team_audit_team_created
  ON business_team_audit_log(team_id, created_at DESC);

-- Operational backup/restore status.
CREATE TABLE IF NOT EXISTS backup_restore_operations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  requested_by UUID REFERENCES users(id) ON DELETE SET NULL,
  approved_by UUID REFERENCES users(id) ON DELETE SET NULL,
  operation_type TEXT NOT NULL CHECK (operation_type IN ('backup_check', 'restore_dry_run', 'restore_request', 'restore_approved', 'restore_completed', 'restore_rejected')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'running', 'completed', 'failed', 'rejected')),
  backup_reference TEXT,
  typed_confirmation TEXT,
  result JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  approved_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_backup_restore_operations_created
  ON backup_restore_operations(created_at DESC);

DO $$
DECLARE
  tbl TEXT;
BEGIN
  FOREACH tbl IN ARRAY ARRAY[
    'notification_preferences',
    'push_subscriptions',
    'coupon_redemptions',
    'saved_searches',
    'recommendation_preferences',
    'recommendation_events',
    'business_team_roles',
    'business_team_invites',
    'business_team_audit_log',
    'backup_restore_operations'
  ]
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', tbl);
    EXECUTE format('REVOKE ALL ON TABLE %I FROM anon, authenticated', tbl);
  END LOOP;
END $$;

COMMENT ON TABLE notification_preferences IS 'Per-user notification channel controls; critical events are enforced by API defaults.';
COMMENT ON TABLE push_subscriptions IS 'Browser Web Push subscriptions; VAPID keys stay in env.';
COMMENT ON TABLE coupon_redemptions IS 'Coupon application ledger for one-best-coupon settlement and reversal.';
COMMENT ON TABLE saved_searches IS 'User-saved service/need searches; first version is in-app only.';
COMMENT ON TABLE recommendation_events IS 'Consent-gated personalization events with retention handled by workers.';
COMMENT ON TABLE business_team_roles IS 'Built-in and custom business-team roles with permissions.';
COMMENT ON TABLE backup_restore_operations IS 'Admin-visible backup and restore operation audit trail.';
