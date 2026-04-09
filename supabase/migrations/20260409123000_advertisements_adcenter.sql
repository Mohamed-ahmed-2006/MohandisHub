CREATE TABLE IF NOT EXISTS advertisement_plans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name_en TEXT NOT NULL,
  name_ar TEXT,
  duration_days INT NOT NULL CHECK (duration_days > 0),
  price NUMERIC(12,2) NOT NULL CHECK (price >= 0),
  currency TEXT NOT NULL DEFAULT 'EGP',
  description_en TEXT,
  description_ar TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  admin_override_allowed BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS ad_pricing_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  role_scope TEXT[] NOT NULL DEFAULT '{}',
  country_scope TEXT[] NOT NULL DEFAULT '{}',
  city_scope TEXT[] NOT NULL DEFAULT '{}',
  category_scope UUID[] NOT NULL DEFAULT '{}',
  min_duration_days INT,
  max_duration_days INT,
  price_multiplier NUMERIC(8,4) NOT NULL DEFAULT 1.0,
  flat_fee NUMERIC(12,2) NOT NULL DEFAULT 0,
  starts_at TIMESTAMPTZ,
  ends_at TIMESTAMPTZ,
  priority INT NOT NULL DEFAULT 0,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS advertisements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  advertiser_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  ad_plan_id UUID REFERENCES advertisement_plans(id) ON DELETE SET NULL,
  title_en TEXT NOT NULL,
  title_ar TEXT,
  description_en TEXT,
  description_ar TEXT,
  image_url TEXT NOT NULL,
  cta_text_en TEXT,
  cta_text_ar TEXT,
  link_type TEXT NOT NULL CHECK (link_type IN ('profile', 'service', 'need', 'external')),
  link_target TEXT,
  status TEXT NOT NULL DEFAULT 'pending_payment'
    CHECK (status IN ('pending_payment', 'active', 'expired', 'cancelled', 'paused_by_admin')),
  amount_paid NUMERIC(12,2),
  starts_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,
  priority INT NOT NULL DEFAULT 0,
  target_roles TEXT[] NOT NULL DEFAULT '{}',
  target_countries TEXT[] NOT NULL DEFAULT '{}',
  target_cities TEXT[] NOT NULL DEFAULT '{}',
  target_categories UUID[] NOT NULL DEFAULT '{}',
  target_languages TEXT[] NOT NULL DEFAULT '{}',
  target_min_budget NUMERIC(12,2),
  target_max_budget NUMERIC(12,2),
  admin_forced_starts_at TIMESTAMPTZ,
  admin_forced_expires_at TIMESTAMPTZ,
  admin_status_reason TEXT,
  admin_price_override NUMERIC(12,2),
  impressions INT NOT NULL DEFAULT 0,
  clicks INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_advertisements_status_expires
  ON advertisements(status, expires_at);
CREATE INDEX IF NOT EXISTS idx_advertisements_advertiser
  ON advertisements(advertiser_id);
CREATE INDEX IF NOT EXISTS idx_advertisements_target_roles
  ON advertisements USING GIN(target_roles);
CREATE INDEX IF NOT EXISTS idx_advertisements_target_countries
  ON advertisements USING GIN(target_countries);
CREATE INDEX IF NOT EXISTS idx_advertisements_target_cities
  ON advertisements USING GIN(target_cities);
CREATE INDEX IF NOT EXISTS idx_advertisements_target_categories
  ON advertisements USING GIN(target_categories);
CREATE INDEX IF NOT EXISTS idx_advertisements_target_languages
  ON advertisements USING GIN(target_languages);

INSERT INTO advertisement_plans (name_en, name_ar, duration_days, price, currency, description_en, description_ar)
SELECT 'Starter 7 Days', 'خطة 7 أيام', 7, 150, 'EGP', 'Basic promotion for one week', 'إعلان أساسي لمدة أسبوع'
WHERE NOT EXISTS (SELECT 1 FROM advertisement_plans);

