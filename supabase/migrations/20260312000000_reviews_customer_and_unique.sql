-- Allow reviews targeting customers (provider reviews customer after reservation).
-- One review per reservation per reviewer (customer can review provider, provider can review customer).

ALTER TABLE reviews DROP CONSTRAINT IF EXISTS reviews_target_type_check;
ALTER TABLE reviews ADD CONSTRAINT reviews_target_type_check
  CHECK (target_type IN ('expert', 'business', 'customer'));

CREATE UNIQUE INDEX IF NOT EXISTS idx_reviews_reservation_reviewer_unique
  ON reviews(reservation_id, reviewer_id)
  WHERE reservation_id IS NOT NULL;
