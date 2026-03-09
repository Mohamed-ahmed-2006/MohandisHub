-- ============================================================================
-- MohandisHub — v023: Reviews and ratings
-- ============================================================================

CREATE TABLE IF NOT EXISTS reviews (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reviewer_id UUID NOT NULL REFERENCES users(id),
  target_user_id UUID NOT NULL REFERENCES users(id),
  target_type VARCHAR(20) NOT NULL CHECK (target_type IN ('expert', 'business')),
  booking_id UUID REFERENCES bookings(id),
  need_id UUID REFERENCES needs(id),
  rating SMALLINT NOT NULL CHECK (rating >= 1 AND rating <= 5),
  comment TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_review_reference CHECK (booking_id IS NOT NULL OR need_id IS NOT NULL)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_reviews_booking_unique ON reviews(booking_id) WHERE booking_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_reviews_need_unique ON reviews(need_id) WHERE need_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_reviews_target ON reviews(target_user_id);
CREATE INDEX IF NOT EXISTS idx_reviews_reviewer ON reviews(reviewer_id);
