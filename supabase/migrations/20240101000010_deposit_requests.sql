-- ============================================================================
-- MohandisHub — v010: Deposit requests (for Cryptomus / crypto)
-- ============================================================================

CREATE TABLE IF NOT EXISTS deposit_requests (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID          NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  wallet_id       UUID          NOT NULL REFERENCES wallets(id) ON DELETE CASCADE,
  amount          NUMERIC(12,2) NOT NULL,
  currency        VARCHAR(3)    NOT NULL DEFAULT 'EGP',
  order_id        VARCHAR(128)  UNIQUE NOT NULL,
  cryptomus_uuid  VARCHAR(255),
  status          VARCHAR(20)   NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'paid', 'expired', 'failed', 'cancelled')),
  created_at      TIMESTAMPTZ   NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ   NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_deposit_requests_order_id ON deposit_requests(order_id);
CREATE INDEX IF NOT EXISTS idx_deposit_requests_user_id ON deposit_requests(user_id);
CREATE INDEX IF NOT EXISTS idx_deposit_requests_status ON deposit_requests(status);

CREATE TRIGGER set_deposit_requests_updated_at
  BEFORE UPDATE ON deposit_requests
  FOR EACH ROW
  EXECUTE FUNCTION trigger_set_updated_at();
