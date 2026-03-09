-- ============================================================================
-- MohandisHub — v009: Service categories (with i18n columns) and services
-- ============================================================================

-- --------------------------------------------------------------------------
-- 1. Service categories — admin-managed, bilingual
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS service_categories (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name_en         VARCHAR(100)  NOT NULL,
  name_ar         VARCHAR(100)  NOT NULL,
  slug            VARCHAR(100)  UNIQUE NOT NULL,
  description_en  TEXT,
  description_ar  TEXT,
  icon            VARCHAR(50),
  parent_id       UUID          REFERENCES service_categories(id) ON DELETE SET NULL,
  sort_order      SMALLINT      DEFAULT 0,
  is_active       BOOLEAN       NOT NULL DEFAULT true,
  created_at      TIMESTAMPTZ   NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ   NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_service_categories_slug   ON service_categories(slug);
CREATE INDEX IF NOT EXISTS idx_service_categories_parent ON service_categories(parent_id);

CREATE TRIGGER set_service_categories_updated_at
  BEFORE UPDATE ON service_categories
  FOR EACH ROW
  EXECUTE FUNCTION trigger_set_updated_at();

-- Seed engineering-focused categories
INSERT INTO service_categories (name_en, name_ar, slug, icon, sort_order) VALUES
  ('Structural Engineering',  'الهندسة الإنشائية',   'structural-engineering',  'building',    1),
  ('Electrical Engineering',  'الهندسة الكهربائية',   'electrical-engineering',  'zap',         2),
  ('Civil Engineering',       'الهندسة المدنية',      'civil-engineering',       'road',        3),
  ('Mechanical Engineering',  'الهندسة الميكانيكية',  'mechanical-engineering',  'cog',         4),
  ('Architectural Design',    'التصميم المعماري',     'architectural-design',    'drafting',    5),
  ('Consultation',            'استشارة',              'consultation',            'message',     6),
  ('Site Visit',              'زيارة موقع',           'site-visit',              'map-pin',     7),
  ('Inspection',              'فحص ومعاينة',          'inspection',              'search',      8),
  ('Project Management',      'إدارة المشاريع',       'project-management',      'clipboard',   9),
  ('HVAC',                    'تكييف وتبريد',         'hvac',                    'thermometer', 10),
  ('Plumbing',                'السباكة',              'plumbing',                'droplet',     11),
  ('Surveying',               'المساحة',              'surveying',               'compass',     12)
ON CONFLICT (slug) DO NOTHING;

-- --------------------------------------------------------------------------
-- 2. Services — provider offerings
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS services (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id       UUID          NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  category_id       UUID          REFERENCES service_categories(id) ON DELETE SET NULL,
  title             VARCHAR(300)  NOT NULL,
  description       TEXT,
  price             NUMERIC(10,2),
  price_type        VARCHAR(20)   DEFAULT 'fixed'
    CHECK (price_type IN ('fixed', 'hourly', 'negotiable')),
  currency          VARCHAR(3)    DEFAULT 'EGP',
  delivery_time_days SMALLINT,
  status            VARCHAR(20)   NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'pending_review', 'active', 'paused', 'rejected', 'archived')),
  rejection_reason  TEXT,
  reviewed_by       UUID          REFERENCES users(id),
  reviewed_at       TIMESTAMPTZ,
  tags              TEXT[]        DEFAULT '{}',
  images            TEXT[]        DEFAULT '{}',
  is_featured       BOOLEAN       NOT NULL DEFAULT false,
  view_count        INTEGER       DEFAULT 0,
  order_count       INTEGER       DEFAULT 0,
  avg_rating        NUMERIC(3,2),
  city              VARCHAR(100),
  area              VARCHAR(100),
  country           VARCHAR(100)  DEFAULT 'Egypt',
  created_at        TIMESTAMPTZ   NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ   NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_services_provider   ON services(provider_id);
CREATE INDEX IF NOT EXISTS idx_services_category   ON services(category_id);
CREATE INDEX IF NOT EXISTS idx_services_status     ON services(status);
CREATE INDEX IF NOT EXISTS idx_services_city       ON services(city);
CREATE INDEX IF NOT EXISTS idx_services_featured   ON services(is_featured) WHERE is_featured = true;
CREATE INDEX IF NOT EXISTS idx_services_tags       ON services USING GIN(tags);

CREATE TRIGGER set_services_updated_at
  BEFORE UPDATE ON services
  FOR EACH ROW
  EXECUTE FUNCTION trigger_set_updated_at();
