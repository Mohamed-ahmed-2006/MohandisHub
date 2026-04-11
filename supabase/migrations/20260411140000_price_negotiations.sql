-- Price negotiations between customers and providers for negotiable services

CREATE TABLE IF NOT EXISTS price_negotiations (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  service_id         UUID NOT NULL REFERENCES services(id) ON DELETE CASCADE,
  customer_id        UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider_id        UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status             VARCHAR(20) NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'accepted', 'rejected', 'expired', 'cancelled', 'consumed')),
  original_price     NUMERIC(12,2),
  agreed_price       NUMERIC(12,2),
  latest_amount      NUMERIC(12,2) NOT NULL,
  latest_offered_by  UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  currency           VARCHAR(3) NOT NULL DEFAULT 'EGP',
  expires_at         TIMESTAMPTZ NOT NULL,
  agreed_valid_until TIMESTAMPTZ,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_price_negotiations_customer ON price_negotiations(customer_id);
CREATE INDEX IF NOT EXISTS idx_price_negotiations_provider ON price_negotiations(provider_id);
CREATE INDEX IF NOT EXISTS idx_price_negotiations_service ON price_negotiations(service_id);
CREATE INDEX IF NOT EXISTS idx_price_negotiations_status ON price_negotiations(status);

-- One active (pending) negotiation per customer per service
CREATE UNIQUE INDEX IF NOT EXISTS uq_price_negotiations_pending_customer_service
  ON price_negotiations(service_id, customer_id)
  WHERE status = 'pending';

CREATE TABLE IF NOT EXISTS price_negotiation_rounds (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  negotiation_id   UUID NOT NULL REFERENCES price_negotiations(id) ON DELETE CASCADE,
  offered_by       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  amount           NUMERIC(12,2) NOT NULL,
  message          TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_price_negotiation_rounds_negotiation
  ON price_negotiation_rounds(negotiation_id, created_at);
