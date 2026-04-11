-- Fix: allow reviews that reference only a reservation_id (no legacy booking_id).
-- The original constraint required booking_id or need_id to be non-null,
-- but reservations created after the migration to the reservations system
-- have no legacy_booking_id, causing INSERT to fail with a CHECK violation.

ALTER TABLE reviews DROP CONSTRAINT IF EXISTS chk_review_reference;
ALTER TABLE reviews ADD CONSTRAINT chk_review_reference
  CHECK (reservation_id IS NOT NULL OR booking_id IS NOT NULL OR need_id IS NOT NULL);
