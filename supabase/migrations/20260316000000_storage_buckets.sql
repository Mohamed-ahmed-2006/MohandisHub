-- ============================================================================
-- MohandisHub - Storage buckets for Supabase Storage
-- ============================================================================
-- Creates buckets: uploads (general), verification-docs (KYC/verification).
-- When using Supabase Storage, set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY
-- in the API env and use the upload API; files are stored here instead of local disk.
-- ============================================================================

INSERT INTO storage.buckets (id, name, public)
VALUES
  ('uploads', 'uploads', true),
  ('verification-docs', 'verification-docs', false)
ON CONFLICT (id) DO NOTHING;
