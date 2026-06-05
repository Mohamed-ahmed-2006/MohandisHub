-- ============================================================================
-- MohandisHub — EGP finalization
-- ============================================================================
-- The wallet ledger is already EGP-primary in application logic. This locks in
-- EGP everywhere: wallet column default, and stale USD labels on plans/coupons.

-- Wallet currency default (earlier USD pivot left the column default as USD).
ALTER TABLE wallets ALTER COLUMN currency SET DEFAULT 'EGP';

-- Normalize any non-EGP currency labels still present on wallets.
UPDATE wallets SET currency = 'EGP' WHERE currency IS NULL OR currency <> 'EGP';

-- Plans were flipped to USD by 20260314000001; amounts are treated as EGP at
-- runtime, so realign the column default + labels.
ALTER TABLE plans ALTER COLUMN currency SET DEFAULT 'EGP';
UPDATE plans SET currency = 'EGP' WHERE currency IS NULL OR currency <> 'EGP';

-- Coupons defaulted to USD; realign the column default + labels.
ALTER TABLE coupons ALTER COLUMN currency SET DEFAULT 'EGP';
UPDATE coupons SET currency = 'EGP' WHERE currency IS NULL OR currency <> 'EGP';
