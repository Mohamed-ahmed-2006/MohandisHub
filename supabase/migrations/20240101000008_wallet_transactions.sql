-- ============================================================================
-- MohandisHub — v008: Wallets and transactions
-- ============================================================================

-- --------------------------------------------------------------------------
-- 1. Wallets — one per user
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS wallets (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID UNIQUE NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  balance     NUMERIC(12,2) NOT NULL DEFAULT 0.00,
  currency    VARCHAR(3)    NOT NULL DEFAULT 'EGP',
  is_frozen   BOOLEAN       NOT NULL DEFAULT false,
  created_at  TIMESTAMPTZ   NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ   NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_wallets_user_id ON wallets(user_id);

CREATE TRIGGER set_wallets_updated_at
  BEFORE UPDATE ON wallets
  FOR EACH ROW
  EXECUTE FUNCTION trigger_set_updated_at();

-- --------------------------------------------------------------------------
-- 2. Transactions — ledger of all wallet movements
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS transactions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  wallet_id       UUID          NOT NULL REFERENCES wallets(id),
  user_id         UUID          NOT NULL REFERENCES users(id),
  type            VARCHAR(30)   NOT NULL
    CHECK (type IN ('deposit', 'withdrawal', 'payment', 'refund', 'adjustment', 'bonus')),
  amount          NUMERIC(12,2) NOT NULL,
  balance_after   NUMERIC(12,2) NOT NULL,
  status          VARCHAR(20)   NOT NULL DEFAULT 'completed'
    CHECK (status IN ('pending', 'completed', 'failed', 'reversed')),
  description     TEXT,
  reference_type  VARCHAR(30),
  reference_id    UUID,
  metadata        JSONB         DEFAULT '{}',
  created_by      UUID          REFERENCES users(id),
  created_at      TIMESTAMPTZ   NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_transactions_wallet_id ON transactions(wallet_id);
CREATE INDEX IF NOT EXISTS idx_transactions_user_id   ON transactions(user_id);
CREATE INDEX IF NOT EXISTS idx_transactions_type      ON transactions(type);
CREATE INDEX IF NOT EXISTS idx_transactions_status    ON transactions(status);
CREATE INDEX IF NOT EXISTS idx_transactions_created   ON transactions(created_at);
