-- Add optional attachment URLs to support ticket messages (e.g. from POST /api/upload)
ALTER TABLE support_ticket_messages
  ADD COLUMN IF NOT EXISTS attachment_urls TEXT[] DEFAULT '{}';

COMMENT ON COLUMN support_ticket_messages.attachment_urls IS 'Public URLs of attached images/files (from upload API)';
