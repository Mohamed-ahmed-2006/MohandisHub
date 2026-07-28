-- ============================================================================
-- service_aggregate_triggers
-- ----------------------------------------------------------------------------
-- RECOVERED MIGRATION — restored to version control on 2026-07-29.
--
-- This file was applied to the database but was missing from the repository.
-- The SQL below is the ORIGINAL text, recovered verbatim from
-- supabase_migrations.schema_migrations.statements (the statement list the
-- Supabase CLI recorded when it applied this migration). It is NOT a
-- reconstruction from the live schema.
--
-- Statements are re-joined in their recorded execution order. Only the
-- statement separator was re-added; no statement text was altered.
--
-- Applied version: 20260727093000
-- Statements:      10
-- ============================================================================

-- Database-controlled service order and rating aggregates.

CREATE OR REPLACE FUNCTION refresh_service_aggregates(target_service_id UUID)
RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
  IF target_service_id IS NULL THEN
    RETURN;
  END IF;

  UPDATE services s
     SET order_count = (
           SELECT COUNT(*)::integer
             FROM reservations r
            WHERE r.service_id = target_service_id
              AND r.status = 'completed'
         ),
         avg_rating = (
           SELECT ROUND(AVG(rv.rating)::numeric, 2)
             FROM reviews rv
             JOIN reservations r ON r.id = rv.reservation_id
            WHERE r.service_id = target_service_id
              AND r.status = 'completed'
              AND rv.hidden = false
              AND rv.reviewer_id = r.customer_id
              AND rv.target_user_id = r.provider_id
         )
   WHERE s.id = target_service_id;
END;
$$;

CREATE OR REPLACE FUNCTION refresh_service_aggregates_from_reservation()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP <> 'INSERT' THEN
    PERFORM refresh_service_aggregates(OLD.service_id);
  END IF;
  IF TG_OP <> 'DELETE' AND (TG_OP = 'INSERT' OR NEW.service_id IS DISTINCT FROM OLD.service_id
      OR NEW.status IS DISTINCT FROM OLD.status) THEN
    PERFORM refresh_service_aggregates(NEW.service_id);
  END IF;
  -- Return values are ignored for AFTER triggers.
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_refresh_service_aggregates_reservation ON reservations;

CREATE TRIGGER trg_refresh_service_aggregates_reservation
AFTER INSERT OR UPDATE OF service_id, status OR DELETE
ON reservations
FOR EACH ROW
EXECUTE FUNCTION refresh_service_aggregates_from_reservation();

CREATE OR REPLACE FUNCTION refresh_service_aggregates_from_review()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  old_service_id UUID;
  new_service_id UUID;
BEGIN
  IF TG_OP <> 'INSERT' AND OLD.reservation_id IS NOT NULL THEN
    SELECT service_id INTO old_service_id FROM reservations WHERE id = OLD.reservation_id;
    PERFORM refresh_service_aggregates(old_service_id);
  END IF;
  IF TG_OP <> 'DELETE' AND NEW.reservation_id IS NOT NULL THEN
    SELECT service_id INTO new_service_id FROM reservations WHERE id = NEW.reservation_id;
    IF new_service_id IS DISTINCT FROM old_service_id
       OR TG_OP = 'INSERT'
       OR NEW.rating IS DISTINCT FROM OLD.rating
       OR NEW.hidden IS DISTINCT FROM OLD.hidden
       OR NEW.reviewer_id IS DISTINCT FROM OLD.reviewer_id
       OR NEW.target_user_id IS DISTINCT FROM OLD.target_user_id THEN
      PERFORM refresh_service_aggregates(new_service_id);
    END IF;
  END IF;
  -- Return values are ignored for AFTER triggers.
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_refresh_service_aggregates_review ON reviews;

CREATE TRIGGER trg_refresh_service_aggregates_review
AFTER INSERT OR UPDATE OF reservation_id, rating, hidden, reviewer_id, target_user_id OR DELETE
ON reviews
FOR EACH ROW
EXECUTE FUNCTION refresh_service_aggregates_from_review();

CREATE INDEX IF NOT EXISTS idx_reservations_service_completed
  ON reservations (service_id)
  WHERE status = 'completed';

CREATE INDEX IF NOT EXISTS idx_reviews_visible_reservation
  ON reviews (reservation_id, reviewer_id, target_user_id)
  WHERE hidden = false AND reservation_id IS NOT NULL;

DO $$
DECLARE
  service_row RECORD;
BEGIN
  FOR service_row IN SELECT id FROM services LOOP
    PERFORM refresh_service_aggregates(service_row.id);
  END LOOP;
END;
$$;
