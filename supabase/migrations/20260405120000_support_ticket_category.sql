-- Ticket category for bug reports, suggestions, etc.
ALTER TABLE support_tickets
  ADD COLUMN IF NOT EXISTS category VARCHAR(30) NOT NULL DEFAULT 'other';

ALTER TABLE support_tickets
  DROP CONSTRAINT IF EXISTS support_tickets_category_check;

ALTER TABLE support_tickets
  ADD CONSTRAINT support_tickets_category_check
  CHECK (category IN ('bug', 'suggestion', 'error', 'other'));

COMMENT ON COLUMN support_tickets.category IS 'User-facing ticket type: bug, suggestion, error, other';
