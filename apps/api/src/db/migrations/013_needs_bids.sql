-- Customer needs and expert bids
CREATE TABLE IF NOT EXISTS needs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id UUID NOT NULL REFERENCES users(id),
  title VARCHAR(300) NOT NULL,
  description TEXT NOT NULL,
  category_id UUID REFERENCES service_categories(id),
  budget_type VARCHAR(10) NOT NULL DEFAULT 'fixed' CHECK (budget_type IN ('fixed', 'hourly')),
  budget_amount DECIMAL(12,2) NOT NULL,
  currency VARCHAR(10) NOT NULL DEFAULT 'EGP',
  timeline_days INT,
  city VARCHAR(100),
  country VARCHAR(100),
  status VARCHAR(20) NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed', 'awarded')),
  awarded_bid_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS bids (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  need_id UUID NOT NULL REFERENCES needs(id) ON DELETE CASCADE,
  expert_id UUID NOT NULL REFERENCES users(id),
  amount DECIMAL(12,2) NOT NULL,
  currency VARCHAR(10) NOT NULL DEFAULT 'EGP',
  message TEXT NOT NULL,
  delivery_days INT,
  status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'rejected')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (need_id, expert_id)
);

ALTER TABLE needs ADD CONSTRAINT fk_awarded_bid FOREIGN KEY (awarded_bid_id) REFERENCES bids(id);

CREATE INDEX IF NOT EXISTS idx_needs_customer ON needs(customer_id);
CREATE INDEX IF NOT EXISTS idx_needs_status ON needs(status);
CREATE INDEX IF NOT EXISTS idx_bids_need ON bids(need_id);
CREATE INDEX IF NOT EXISTS idx_bids_expert ON bids(expert_id);
