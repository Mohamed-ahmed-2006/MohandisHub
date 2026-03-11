-- ============================================================================
-- MohandisHub - v034: Wallet currency default to USD
-- ============================================================================

ALTER TABLE wallets
  ALTER COLUMN currency SET DEFAULT 'USD';

UPDATE wallets
SET currency = 'USD'
WHERE currency = 'EGP';
