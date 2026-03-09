-- ============================================================================
-- MohandisHub — v020: Bid payment flow (wallet debit/credit + commission)
-- ============================================================================

-- 1. Add 'commission' to transactions type
ALTER TABLE transactions DROP CONSTRAINT IF EXISTS transactions_type_check;
ALTER TABLE transactions ADD CONSTRAINT transactions_type_check
  CHECK (type IN ('deposit', 'withdrawal', 'payment', 'refund', 'adjustment', 'bonus', 'commission'));

-- 2. Add paid_at and payment_transaction_id to bids
ALTER TABLE bids
  ADD COLUMN IF NOT EXISTS paid_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS payment_transaction_id UUID REFERENCES transactions(id);

-- 3. Platform user and wallet for commission accumulation
INSERT INTO users (id, email, password_hash, display_name, primary_role)
VALUES (
  '00000000-0000-0000-0000-000000000001',
  'platform@mohandishub.internal',
  'no-login',
  'Platform',
  'customer'
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO wallets (user_id)
SELECT '00000000-0000-0000-0000-000000000001'
WHERE NOT EXISTS (SELECT 1 FROM wallets WHERE user_id = '00000000-0000-0000-0000-000000000001');
