-- Promotions / coupons (stub for first-booking or plan discount)
CREATE TABLE IF NOT EXISTS coupons (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code         VARCHAR(50) NOT NULL UNIQUE,
  type         VARCHAR(30) NOT NULL DEFAULT 'fixed' CHECK (type IN ('fixed', 'percent')),
  value        NUMERIC(10,2) NOT NULL,
  currency     VARCHAR(3) DEFAULT 'USD',
  valid_from   TIMESTAMPTZ NOT NULL DEFAULT now(),
  valid_until   TIMESTAMPTZ,
  max_uses     INTEGER,
  use_count    INTEGER NOT NULL DEFAULT 0,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_coupons_code ON coupons(code);
COMMENT ON TABLE coupons IS 'Promo codes for discounts (expand with redemption tracking)';
