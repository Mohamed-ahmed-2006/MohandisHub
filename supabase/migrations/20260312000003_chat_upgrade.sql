-- Chat upgrade: reply, message types (text/image/voice/link/location), attachment, soft delete

ALTER TABLE messages
  ADD COLUMN IF NOT EXISTS reply_to_id UUID REFERENCES messages(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS message_type VARCHAR(20) NOT NULL DEFAULT 'text'
    CHECK (message_type IN ('text', 'image', 'voice', 'link', 'location')),
  ADD COLUMN IF NOT EXISTS attachment_url TEXT,
  ADD COLUMN IF NOT EXISTS link_url TEXT,
  ADD COLUMN IF NOT EXISTS location_lat NUMERIC,
  ADD COLUMN IF NOT EXISTS location_lng NUMERIC,
  ADD COLUMN IF NOT EXISTS location_label TEXT,
  ADD COLUMN IF NOT EXISTS deleted_for_sender BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS deleted_for_everyone BOOLEAN NOT NULL DEFAULT false;

-- Allow empty body for non-text types (e.g. location with label only)
ALTER TABLE messages ALTER COLUMN body DROP NOT NULL;
UPDATE messages SET body = '' WHERE body IS NULL;
ALTER TABLE messages ALTER COLUMN body SET DEFAULT '';

CREATE INDEX IF NOT EXISTS idx_messages_reply_to ON messages(reply_to_id);
