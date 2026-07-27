-- Reviewable advertisement lifecycle, escrow-backed pricing, and deduplicated delivery metrics.

ALTER TABLE advertisements
  DROP CONSTRAINT IF EXISTS advertisements_status_check,
  DROP CONSTRAINT IF EXISTS advertisements_link_type_check;

UPDATE advertisements
SET status = 'cancelled',
    admin_status_reason = COALESCE(admin_status_reason, 'unsupported_legacy_destination')
WHERE link_type NOT IN ('profile', 'service');

UPDATE advertisements
SET status = 'pending_review'
WHERE status = 'pending_payment';

ALTER TABLE advertisements
  ADD CONSTRAINT advertisements_status_check
    CHECK (status IN (
      'pending_review', 'scheduled', 'active', 'paused_by_admin',
      'rejected', 'expired', 'cancelled'
    )),
  ADD CONSTRAINT advertisements_link_type_check
    CHECK (link_type IN ('profile', 'service', 'need', 'external')),
  ADD COLUMN IF NOT EXISTS duration_days INTEGER,
  ADD COLUMN IF NOT EXISTS daily_price_piastres INTEGER,
  ADD COLUMN IF NOT EXISTS quoted_amount_piastres BIGINT,
  ADD COLUMN IF NOT EXISTS wallet_hold_id UUID REFERENCES wallet_holds(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS banner_upload_id UUID REFERENCES upload_objects(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS destination_provider_id UUID REFERENCES users(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS destination_service_id UUID REFERENCES services(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS reviewed_by UUID REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS rejection_reason TEXT,
  ADD COLUMN IF NOT EXISTS paused_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS paused_seconds BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS cancellation_refund_piastres BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS content_locked_at TIMESTAMPTZ;

UPDATE advertisements
SET duration_days = GREATEST(
      1,
      CEIL(EXTRACT(EPOCH FROM (expires_at - starts_at)) / 86400.0)::integer
    ),
    daily_price_piastres = CASE
      WHEN amount_paid IS NULL OR starts_at IS NULL OR expires_at IS NULL THEN 0
      ELSE ROUND(
        amount_paid * 100 /
        GREATEST(1, CEIL(EXTRACT(EPOCH FROM (expires_at - starts_at)) / 86400.0))
      )::integer
    END,
    quoted_amount_piastres = COALESCE(ROUND(amount_paid * 100)::bigint, 0),
    destination_provider_id = CASE WHEN link_type = 'profile' THEN advertiser_id ELSE NULL END,
    destination_service_id = CASE
      WHEN link_type = 'service'
       AND link_target ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      THEN link_target::uuid
      ELSE NULL
    END,
    content_locked_at = CASE WHEN status IN ('scheduled', 'active', 'paused_by_admin', 'expired') THEN updated_at ELSE NULL END
WHERE duration_days IS NULL
   OR daily_price_piastres IS NULL
   OR quoted_amount_piastres IS NULL;

-- Legacy destinations remain readable, but invalid or unsupported campaigns
-- cannot continue serving after this migration.
UPDATE advertisements a
SET status = 'cancelled',
    admin_status_reason = COALESCE(
      a.admin_status_reason,
      'unsupported_or_inactive_legacy_destination'
    )
WHERE a.status <> 'cancelled'
  AND (
    a.link_type NOT IN ('profile', 'service')
    OR (
      a.link_type = 'profile'
      AND NOT EXISTS (
        SELECT 1
        FROM users u
        WHERE u.id = a.advertiser_id
          AND u.deleted_at IS NULL
          AND u.is_active = true
          AND u.primary_role IN ('expert', 'business', 'craftsman')
      )
    )
    OR (
      a.link_type = 'service'
      AND NOT EXISTS (
        SELECT 1
        FROM services s
        WHERE s.id = a.destination_service_id
          AND s.provider_id = a.advertiser_id
          AND s.status = 'active'
      )
    )
  );

ALTER TABLE advertisements
  ADD CONSTRAINT advertisements_duration_days_check
    CHECK (duration_days IS NULL OR duration_days BETWEEN 1 AND 365),
  ADD CONSTRAINT advertisements_daily_price_piastres_check
    CHECK (daily_price_piastres IS NULL OR daily_price_piastres >= 0),
  ADD CONSTRAINT advertisements_quoted_amount_piastres_check
    CHECK (quoted_amount_piastres IS NULL OR quoted_amount_piastres >= 0),
  ADD CONSTRAINT advertisements_refund_piastres_check
    CHECK (cancellation_refund_piastres >= 0),
  ADD CONSTRAINT advertisements_destination_check
    CHECK (
      (link_type = 'profile' AND destination_provider_id IS NOT NULL AND destination_service_id IS NULL)
      OR
      (link_type = 'service' AND destination_service_id IS NOT NULL)
      OR status = 'cancelled'
    ) NOT VALID;

ALTER TABLE advertisements
  VALIDATE CONSTRAINT advertisements_destination_check;

CREATE INDEX IF NOT EXISTS idx_advertisements_review_queue
  ON advertisements(status, created_at)
  WHERE status = 'pending_review';
CREATE UNIQUE INDEX IF NOT EXISTS idx_advertisements_wallet_hold
  ON advertisements(wallet_hold_id)
  WHERE wallet_hold_id IS NOT NULL;

CREATE TABLE advertisement_delivery_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  advertisement_id UUID NOT NULL REFERENCES advertisements(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL CHECK (event_type IN ('impression', 'click')),
  viewer_hash CHAR(64) NOT NULL CHECK (viewer_hash ~ '^[0-9a-f]{64}$'),
  impression_event_id UUID REFERENCES advertisement_delivery_events(id) ON DELETE CASCADE,
  delivery_nonce UUID NOT NULL,
  event_bucket TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (
    (event_type = 'impression' AND impression_event_id IS NULL)
    OR
    (event_type = 'click' AND impression_event_id IS NOT NULL)
  )
);

CREATE UNIQUE INDEX idx_ad_delivery_impression_dedupe
  ON advertisement_delivery_events(advertisement_id, viewer_hash, event_bucket)
  WHERE event_type = 'impression';
CREATE UNIQUE INDEX idx_ad_delivery_click_dedupe
  ON advertisement_delivery_events(impression_event_id)
  WHERE event_type = 'click';
CREATE INDEX idx_ad_delivery_metrics
  ON advertisement_delivery_events(advertisement_id, event_type, created_at);

ALTER TABLE advertisement_delivery_events ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE advertisement_delivery_events IS
  'Backend-owned, token-authorized advertisement impressions and clicks; no raw IP address is stored.';
