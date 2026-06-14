-- MohandisHub - Phase 2-5 completion fields.

ALTER TABLE push_subscriptions
  ADD COLUMN IF NOT EXISTS last_success_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS push_delivery_attempts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  push_subscription_id UUID REFERENCES push_subscriptions(id) ON DELETE SET NULL,
  notification_type TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('sent', 'failed', 'skipped')),
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_push_delivery_attempts_user_created
  ON push_delivery_attempts(user_id, created_at DESC);

ALTER TABLE coupons
  ADD COLUMN IF NOT EXISTS discount_target TEXT NOT NULL DEFAULT 'service_price'
    CHECK (discount_target IN ('service_price', 'platform_commission', 'both')),
  ADD COLUMN IF NOT EXISTS platform_share_percent NUMERIC(5,2)
    CHECK (platform_share_percent IS NULL OR platform_share_percent BETWEEN 0 AND 100),
  ADD COLUMN IF NOT EXISTS provider_campaign_request_id UUID,
  ADD COLUMN IF NOT EXISTS generated_quantity INTEGER
    CHECK (generated_quantity IS NULL OR generated_quantity > 0),
  ADD COLUMN IF NOT EXISTS fee_per_coupon_egp NUMERIC(12,2)
    CHECK (fee_per_coupon_egp IS NULL OR fee_per_coupon_egp >= 0),
  ADD COLUMN IF NOT EXISTS generation_fee_transaction_id UUID REFERENCES transactions(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS audit_status TEXT NOT NULL DEFAULT 'admin_created'
    CHECK (audit_status IN ('admin_created', 'provider_requested', 'approved', 'rejected', 'disabled'));

ALTER TABLE coupon_redemptions
  ADD COLUMN IF NOT EXISTS discount_target TEXT NOT NULL DEFAULT 'service_price'
    CHECK (discount_target IN ('service_price', 'platform_commission', 'both')),
  ADD COLUMN IF NOT EXISTS service_subtotal NUMERIC(12,2),
  ADD COLUMN IF NOT EXISTS commission_subtotal NUMERIC(12,2),
  ADD COLUMN IF NOT EXISTS service_discount_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS commission_discount_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS provider_funded_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS platform_funded_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS outcome TEXT NOT NULL DEFAULT 'consumed'
    CHECK (outcome IN ('consumed', 'refunded_consumed', 'reversed_consumed')),
  ADD COLUMN IF NOT EXISTS outcome_metadata JSONB NOT NULL DEFAULT '{}'::jsonb;

CREATE TABLE IF NOT EXISTS coupon_campaign_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  requested_by UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  coupon_id UUID REFERENCES coupons(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled')),
  requested_quantity INTEGER NOT NULL CHECK (requested_quantity > 0),
  fee_per_coupon_egp NUMERIC(12,2) NOT NULL CHECK (fee_per_coupon_egp >= 0),
  total_fee_egp NUMERIC(12,2) NOT NULL CHECK (total_fee_egp >= 0),
  fee_transaction_id UUID REFERENCES transactions(id) ON DELETE SET NULL,
  coupon_config JSONB NOT NULL DEFAULT '{}'::jsonb,
  admin_reason TEXT,
  reviewed_by UUID REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_coupon_campaign_requests_provider_status
  ON coupon_campaign_requests(provider_id, status, created_at DESC);

ALTER TABLE app_settings
  ADD COLUMN IF NOT EXISTS coupon_generation_fee_egp NUMERIC(12,2) NOT NULL DEFAULT 0.25;

ALTER TABLE backup_restore_operations
  ADD COLUMN IF NOT EXISTS provider TEXT,
  ADD COLUMN IF NOT EXISTS provider_operation_id TEXT;

DO $$
DECLARE
  table_name TEXT;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'push_delivery_attempts',
    'coupon_campaign_requests'
  ]
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('REVOKE ALL ON TABLE %I FROM anon, authenticated', table_name);
  END LOOP;
END $$;

COMMENT ON TABLE push_delivery_attempts IS 'Audit log for Web Push notification delivery attempts.';
COMMENT ON TABLE coupon_campaign_requests IS 'Provider-requested coupon campaigns with wallet-paid generation fees.';
COMMENT ON COLUMN app_settings.coupon_generation_fee_egp IS 'Platform fee charged per generated provider coupon.';
