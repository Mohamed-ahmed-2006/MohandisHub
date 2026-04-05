-- Admin-controlled: hide specific app sidebar links (stored as JSON array of href strings).
ALTER TABLE app_settings
  ADD COLUMN IF NOT EXISTS sidebar_hidden_hrefs JSONB NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN app_settings.sidebar_hidden_hrefs IS 'JSON array of /app/... hrefs to omit from the in-app sidebar';
