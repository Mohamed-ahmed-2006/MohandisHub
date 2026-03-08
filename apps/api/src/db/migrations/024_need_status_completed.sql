-- ============================================================================
-- MohandisHub — v024: Add 'completed' status to needs for order lifecycle
-- ============================================================================

ALTER TABLE needs DROP CONSTRAINT IF EXISTS needs_status_check;
ALTER TABLE needs ADD CONSTRAINT needs_status_check
  CHECK (status IN ('open', 'closed', 'awarded', 'in_progress', 'completed'));
