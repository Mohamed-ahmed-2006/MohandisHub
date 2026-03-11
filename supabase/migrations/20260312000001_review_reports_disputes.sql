-- Review reports: any user can report a review (inappropriate, fake, spam, etc.)
CREATE TABLE IF NOT EXISTS review_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  review_id UUID NOT NULL REFERENCES reviews(id) ON DELETE CASCADE,
  reporter_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reason VARCHAR(50) NOT NULL CHECK (reason IN ('inappropriate', 'fake', 'spam', 'other')),
  comment TEXT,
  status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'dismissed', 'upheld')),
  reviewed_by UUID REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_review_reports_review ON review_reports(review_id);
CREATE INDEX IF NOT EXISTS idx_review_reports_status ON review_reports(status);

-- Review disputes: the reviewed user (target) can dispute a review
CREATE TABLE IF NOT EXISTS review_disputes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  review_id UUID NOT NULL REFERENCES reviews(id) ON DELETE CASCADE,
  disputer_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reason TEXT NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'dismissed', 'upheld')),
  reviewed_by UUID REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_review_disputes_review ON review_disputes(review_id);
CREATE INDEX IF NOT EXISTS idx_review_disputes_status ON review_disputes(status);

-- Allow admins to hide a review when upholding a report or dispute
ALTER TABLE reviews ADD COLUMN IF NOT EXISTS hidden BOOLEAN NOT NULL DEFAULT false;
CREATE INDEX IF NOT EXISTS idx_reviews_hidden ON reviews(hidden) WHERE hidden = true;
