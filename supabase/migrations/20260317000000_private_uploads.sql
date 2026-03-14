-- ============================================================================
-- Private uploads: store path + owner for sensitive files (verification, CV).
-- Served via GET /api/upload/private/:id with auth; no public URLs returned.
-- ============================================================================

CREATE TABLE IF NOT EXISTS private_uploads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  storage_path TEXT NOT NULL,
  bucket TEXT NOT NULL DEFAULT 'verification-docs',
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  original_name TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_private_uploads_user_id ON private_uploads (user_id);
