-- Time-scoped, privacy-preserving service view events for provider analytics.

CREATE TABLE IF NOT EXISTS service_view_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  service_id UUID NOT NULL REFERENCES services(id) ON DELETE CASCADE,
  viewer_hash CHAR(64) NOT NULL CHECK (viewer_hash ~ '^[0-9a-f]{64}$'),
  view_bucket TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (service_id, viewer_hash, view_bucket)
);

CREATE INDEX IF NOT EXISTS idx_service_view_events_service_created
  ON service_view_events (service_id, created_at DESC);

ALTER TABLE service_view_events ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE service_view_events IS
  'Backend-only deduplicated view events. viewer_hash contains no raw IP or user-agent.';
