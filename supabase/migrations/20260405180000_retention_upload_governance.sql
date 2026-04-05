-- Retention policy, upload limits, sweep log, moderation audit, bid attachment column

ALTER TABLE app_settings
  ADD COLUMN IF NOT EXISTS retention_policy JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS retention_alerts JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS max_public_upload_bytes INTEGER,
  ADD COLUMN IF NOT EXISTS public_upload_allowed_mimes JSONB,
  ADD COLUMN IF NOT EXISTS supabase_storage_dashboard_url TEXT;

COMMENT ON COLUMN app_settings.retention_policy IS 'Per-category retention toggles/values; merged with env ceilings in API';
COMMENT ON COLUMN app_settings.retention_alerts IS 'JSON: webhookUrl, alertEmail, deleteCountThresholds by category key';

CREATE TABLE IF NOT EXISTS retention_sweep_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ,
  dry_run BOOLEAN NOT NULL DEFAULT false,
  results JSONB NOT NULL DEFAULT '{}'::jsonb,
  error TEXT
);

CREATE INDEX IF NOT EXISTS idx_retention_sweep_log_started ON retention_sweep_log (started_at DESC);

CREATE TABLE IF NOT EXISTS admin_moderation_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  action VARCHAR(80) NOT NULL,
  entity_type VARCHAR(80),
  entity_id UUID,
  detail JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_admin_moderation_log_created ON admin_moderation_log (created_at DESC);

ALTER TABLE bid_messages ADD COLUMN IF NOT EXISTS attachment_url TEXT;
