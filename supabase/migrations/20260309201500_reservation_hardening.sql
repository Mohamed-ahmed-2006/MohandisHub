-- ============================================================================
-- MohandisHub - Reservation V2 hardening (lifecycle, overlaps, billing precision)
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS btree_gist;

ALTER TABLE reservations
  ADD COLUMN IF NOT EXISTS done_prompted_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_reservations_disconnect_due
  ON reservations(disconnect_auto_release_at)
  WHERE disconnect_auto_release_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_reservations_customer_done_due
  ON reservations(customer_done_due_at)
  WHERE customer_done_due_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_reservations_done_prompt_due
  ON reservations(customer_done_due_at)
  WHERE customer_done_due_at IS NOT NULL
    AND done_prompted_at IS NULL
    AND status = 'waiting_customer_done';

WITH ranked_slots AS (
  SELECT
    s.id,
    s.provider_id,
    s.start_at,
    s.end_at,
    s.created_at,
    ROW_NUMBER() OVER (
      PARTITION BY s.provider_id
      ORDER BY s.start_at ASC, s.end_at ASC, s.created_at ASC, s.id ASC
    ) AS slot_order
  FROM reservation_slots s
  WHERE s.status IN ('available', 'booked')
), conflicting_later_slots AS (
  SELECT later.id
  FROM ranked_slots later
  WHERE EXISTS (
    SELECT 1
    FROM ranked_slots earlier
    WHERE earlier.provider_id = later.provider_id
      AND earlier.slot_order < later.slot_order
      AND tstzrange(earlier.start_at, earlier.end_at, '[)')
        && tstzrange(later.start_at, later.end_at, '[)')
  )
)
UPDATE reservation_slots s
SET status = 'blocked',
    updated_at = now()
WHERE s.id IN (SELECT id FROM conflicting_later_slots);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'reservation_slots_no_overlap_active'
  ) THEN
    ALTER TABLE reservation_slots
      ADD CONSTRAINT reservation_slots_no_overlap_active
      EXCLUDE USING gist (
        provider_id WITH =,
        tstzrange(start_at, end_at, '[)') WITH &&
      )
      WHERE (status IN ('available', 'booked'));
  END IF;
END $$;

ALTER TABLE reservation_call_sessions
  ADD COLUMN IF NOT EXISTS billed_seconds INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS customer_carry_milli_piaster BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS provider_carry_milli_piaster BIGINT NOT NULL DEFAULT 0;

UPDATE reservation_call_sessions
SET billed_seconds = GREATEST(billed_seconds, billed_minutes * 60)
WHERE billed_minutes > 0;
