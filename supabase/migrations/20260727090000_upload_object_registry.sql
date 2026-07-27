-- Upload ownership, verified metadata, and durable storage-deletion outbox.

CREATE TABLE IF NOT EXISTS upload_objects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  bucket TEXT NOT NULL,
  storage_path TEXT NOT NULL,
  visibility TEXT NOT NULL CHECK (visibility IN ('public', 'private')),
  original_name TEXT,
  detected_mime TEXT NOT NULL,
  size_bytes BIGINT NOT NULL CHECK (size_bytes > 0),
  sha256 CHAR(64) NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  state TEXT NOT NULL DEFAULT 'planned'
    CHECK (state IN ('planned', 'active', 'failed', 'pending_delete', 'deleted')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  activated_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (bucket, storage_path)
);

CREATE INDEX IF NOT EXISTS idx_upload_objects_user_created
  ON upload_objects (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_upload_objects_state_updated
  ON upload_objects (state, updated_at);

CREATE TABLE IF NOT EXISTS storage_deletion_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  upload_object_id UUID NOT NULL UNIQUE REFERENCES upload_objects(id) ON DELETE CASCADE,
  state TEXT NOT NULL DEFAULT 'pending'
    CHECK (state IN ('pending', 'processing', 'completed', 'failed')),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_storage_deletion_jobs_due
  ON storage_deletion_jobs (state, next_attempt_at);

ALTER TABLE private_uploads
  ADD COLUMN IF NOT EXISTS upload_object_id UUID REFERENCES upload_objects(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS detected_mime TEXT,
  ADD COLUMN IF NOT EXISTS size_bytes BIGINT,
  ADD COLUMN IF NOT EXISTS sha256 CHAR(64);

-- Existing private rows have known owners and paths, so they can be registered safely.
INSERT INTO upload_objects (
  user_id, bucket, storage_path, visibility, original_name,
  detected_mime, size_bytes, sha256, state, activated_at
)
SELECT
  p.user_id, p.bucket, p.storage_path, 'private', p.original_name,
  'application/octet-stream', 1, repeat('0', 64), 'active', p.created_at
FROM private_uploads p
WHERE NOT EXISTS (
  SELECT 1 FROM upload_objects o
  WHERE o.bucket = p.bucket AND o.storage_path = p.storage_path
)
ON CONFLICT (bucket, storage_path) DO NOTHING;

UPDATE private_uploads p
SET upload_object_id = o.id
FROM upload_objects o
WHERE p.upload_object_id IS NULL
  AND o.bucket = p.bucket
  AND o.storage_path = p.storage_path;

ALTER TABLE upload_objects ENABLE ROW LEVEL SECURITY;
ALTER TABLE storage_deletion_jobs ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE upload_objects IS
  'Backend-owned registry for upload ownership and content-derived metadata.';
COMMENT ON TABLE storage_deletion_jobs IS
  'Backend-only transactional outbox for idempotent object-storage deletion.';
