-- ============================================================================
-- General chat — contact redaction columns
-- ----------------------------------------------------------------------------
-- Mirrors what 20260728160000 added to bid_messages. The two messaging systems
-- must behave identically: redaction on bid chat alone was worthless while any
-- pair could open a direct conversation and swap phone numbers there
-- (decision D2).
--
--   raw_content      the text as typed, kept for moderation and revealed once
--                    the related job is activated
--   contact_redacted whether anything was stripped from `body`
--
-- `body` continues to hold the text that is safe to serve before activation.
-- Non-destructive: adds nullable columns and a default.
-- ============================================================================

ALTER TABLE public.messages
  ADD COLUMN IF NOT EXISTS contact_redacted BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS raw_content      TEXT;

COMMENT ON COLUMN public.messages.raw_content IS
  'Unredacted text as typed. Never serve before the related job is activated.';
COMMENT ON COLUMN public.messages.contact_redacted IS
  'True when contact details were stripped from body.';

-- Reservation-linked conversations are resolved through this column when
-- deciding whether a conversation is unlocked, so it needs an index.
CREATE INDEX IF NOT EXISTS idx_reservations_conversation
  ON public.reservations(conversation_id)
  WHERE conversation_id IS NOT NULL;
