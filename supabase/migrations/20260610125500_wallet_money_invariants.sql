-- New-write wallet invariants. NOT VALID avoids blocking deploy on historical
-- dirty data, while PostgreSQL still enforces the constraint for new/updated rows.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'chk_wallets_balance_nonnegative'
      AND conrelid = 'public.wallets'::regclass
  ) THEN
    ALTER TABLE public.wallets
      ADD CONSTRAINT chk_wallets_balance_nonnegative CHECK (balance >= 0) NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'chk_transactions_amount_nonnegative'
      AND conrelid = 'public.transactions'::regclass
  ) THEN
    ALTER TABLE public.transactions
      ADD CONSTRAINT chk_transactions_amount_nonnegative CHECK (amount >= 0) NOT VALID;
  END IF;

  IF to_regclass('public.wallet_holds') IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'chk_wallet_holds_amount_positive'
      AND conrelid = 'public.wallet_holds'::regclass
  ) THEN
    ALTER TABLE public.wallet_holds
      ADD CONSTRAINT chk_wallet_holds_amount_positive CHECK (amount > 0) NOT VALID;
  END IF;
END $$;
