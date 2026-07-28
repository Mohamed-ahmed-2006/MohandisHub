-- ============================================================================
-- Legacy EGP money-wallet reset (launch preparation)
-- ============================================================================
--
--   !! READ THIS BEFORE RUNNING ON ANY DATABASE YOU DID NOT PERSONALLY SEED !!
--
-- This migration ZEROES legacy EGP wallet balances and cancels in-flight legacy
-- money requests. It is SAFE ONLY because the target database contains
-- founder-owned test/development data with NO external user funds. That was
-- established by direct inspection on 2026-07-28 and confirmed as business
-- decision D1 (see docs/release/DECISIONS_REQUIRED.md):
--
--     wallets (money)        21 rows,  7 with balance, 2,625,264.07 EGP total
--     wallet_fund_balances  105 rows,  8 non-zero,     2,784,569.71 EGP total
--     wallet_holds           10 'held' rows,           4,724.93 EGP
--     deposit_requests       24 legacy pending + 6 nowpayments pending
--     withdrawal_requests    0 in a non-terminal state
--
-- Note the wallet vs fund-balance totals already disagree by ~159k EGP. The
-- legacy money model is not internally consistent, which is a further reason to
-- reset rather than carry it forward.
--
-- If this migration is ever pointed at a database holding REAL customer money it
-- will destroy balances that users are owed. The guard in section 0 is a
-- speed bump, not a substitute for knowing your target.
--
-- ----------------------------------------------------------------------------
-- Launch model context
-- ----------------------------------------------------------------------------
-- MohandisHub no longer holds customer job money. Customers pay providers
-- directly; the platform earns only from provider MHC spending. The EGP money
-- wallet is retired: frozen, zeroed, and left in place so its transaction history
-- stays auditable.
--
-- Scope discipline:
--   * Every statement below is scoped to account_type = 'money'.
--   * MHC / provider_credit wallets are NEVER touched.
--   * deposit_requests with purpose = 'credit_purchase' are NEVER touched.
--   * transactions rows are PRESERVED. The reset itself is recorded as a new
--     'adjustment' transaction per wallet so the ledger explains the change
--     rather than silently contradicting it.
--
-- Depends on: 20260728120000 (adds wallets.account_type, deposit_requests.purpose)
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 0. Preconditions
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'wallets' AND column_name = 'account_type'
  ) THEN
    RAISE EXCEPTION
      'wallets.account_type is missing: apply 20260728120000_mhc_credits_foundation.sql first.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'deposit_requests' AND column_name = 'purpose'
  ) THEN
    RAISE EXCEPTION
      'deposit_requests.purpose is missing: apply 20260728120000_mhc_credits_foundation.sql first.';
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 1. Cancel non-terminal legacy withdrawal requests
-- ---------------------------------------------------------------------------
-- Withdrawals are disabled for launch. Anything still in flight would otherwise
-- reference a balance that section 5 is about to zero.
UPDATE public.withdrawal_requests
SET status = 'cancelled',
    rejection_reason = COALESCE(
      rejection_reason,
      'Legacy EGP wallet retired at launch; request cancelled during test-data reset.'
    ),
    updated_at = now()
WHERE status IN ('pending', 'pending_verification', 'processing', 'awaiting_transfer', 'admin_review', 'blocked');

-- ---------------------------------------------------------------------------
-- 2. Release outstanding wallet holds on money wallets
-- ---------------------------------------------------------------------------
-- A 'held' row reserves part of a balance. Zeroing the balance underneath a live
-- hold is exactly the "conflicting wallet holds" state we must not leave behind.
UPDATE public.wallet_holds h
SET status = 'cancelled',
    released_at = COALESCE(h.released_at, now()),
    metadata = COALESCE(h.metadata, '{}'::jsonb)
      || jsonb_build_object('legacy_egp_reset', true, 'legacy_egp_reset_at', now()),
    updated_at = now()
FROM public.wallets w
WHERE w.id = h.wallet_id
  AND w.account_type = 'money'
  AND h.status = 'held';

-- ---------------------------------------------------------------------------
-- 3. Cancel in-flight legacy wallet top-up deposit requests
-- ---------------------------------------------------------------------------
-- purpose = 'credit_purchase' (MHC) is deliberately excluded: those belong to the
-- new model and must survive untouched.
UPDATE public.deposit_requests
SET status = 'cancelled',
    rejection_reason = COALESCE(
      rejection_reason,
      'Legacy EGP wallet top-ups retired at launch; request cancelled during test-data reset.'
    ),
    updated_at = now()
WHERE purpose = 'wallet_topup'
  AND status IN ('initiating', 'pending', 'pending_fx', 'pending_review');

-- ---------------------------------------------------------------------------
-- 4. Record the reset in the ledger BEFORE zeroing
-- ---------------------------------------------------------------------------
-- One 'adjustment' per non-zero money wallet, so the balance change is explained
-- by a transaction rather than appearing as unexplained drift. amount is positive
-- (chk_transactions_amount_nonnegative) and balance_delta carries the sign, which
-- matches how every other debit in this ledger is written.
--
-- 'adjustment' is permitted by both transactions_type_check and
-- transactions_type_check_publish_ready.
INSERT INTO public.transactions (
  wallet_id, user_id, type, amount, balance_delta, balance_after, status,
  description, reference_type, reference_id, metadata
)
SELECT
  w.id,
  w.user_id,
  'adjustment',
  w.balance,
  -w.balance,
  0,
  'completed',
  'Legacy EGP test-wallet reset (launch preparation)',
  'legacy_egp_reset',
  w.id,
  jsonb_build_object(
    'asset', 'EGP',
    'previous_balance', w.balance::text,
    'reason', 'founder-owned test data reset per decision D1',
    'migration', '20260729100000_legacy_egp_test_data_reset'
  )
FROM public.wallets w
WHERE w.account_type = 'money'
  AND w.balance <> 0
  -- Idempotency: never write a second reset row for the same wallet.
  AND NOT EXISTS (
    SELECT 1 FROM public.transactions t
    WHERE t.wallet_id = w.id AND t.reference_type = 'legacy_egp_reset'
  );

-- ---------------------------------------------------------------------------
-- 5. Zero the money wallets and their funding-source sub-ledger
-- ---------------------------------------------------------------------------
-- wallet_fund_balances decomposes a wallet balance by funding rail (added by the
-- untracked 20260727120000 migration). Zeroing wallets.balance without zeroing
-- this table would leave the two permanently contradicting each other.
UPDATE public.wallet_fund_balances fb
SET amount = 0,
    updated_at = now()
FROM public.wallets w
WHERE w.id = fb.wallet_id
  AND w.account_type = 'money'
  AND fb.amount <> 0;

UPDATE public.wallets
SET balance = 0,
    updated_at = now()
WHERE account_type = 'money'
  AND balance <> 0;

-- ---------------------------------------------------------------------------
-- 6. Freeze the retired money wallets
-- ---------------------------------------------------------------------------
-- Re-asserted idempotently: 20260728160000 also freezes them, but this migration
-- must leave a correct end state whether or not that one ran.
UPDATE public.wallets
SET is_frozen = true,
    updated_at = now()
WHERE account_type = 'money'
  AND is_frozen = false;

-- ---------------------------------------------------------------------------
-- 7. Validate the end state
-- ---------------------------------------------------------------------------
-- Fail loudly rather than leaving a half-reset money model behind.
DO $$
DECLARE
  bad_wallets   INTEGER;
  bad_funds     INTEGER;
  bad_holds     INTEGER;
  bad_deposits  INTEGER;
  bad_withdraw  INTEGER;
  touched_mhc   INTEGER;
BEGIN
  SELECT count(*) INTO bad_wallets
  FROM public.wallets WHERE account_type = 'money' AND (balance <> 0 OR is_frozen = false);

  SELECT count(*) INTO bad_funds
  FROM public.wallet_fund_balances fb
  JOIN public.wallets w ON w.id = fb.wallet_id
  WHERE w.account_type = 'money' AND fb.amount <> 0;

  SELECT count(*) INTO bad_holds
  FROM public.wallet_holds h
  JOIN public.wallets w ON w.id = h.wallet_id
  WHERE w.account_type = 'money' AND h.status = 'held';

  SELECT count(*) INTO bad_deposits
  FROM public.deposit_requests
  WHERE purpose = 'wallet_topup'
    AND status IN ('initiating', 'pending', 'pending_fx', 'pending_review');

  SELECT count(*) INTO bad_withdraw
  FROM public.withdrawal_requests
  WHERE status IN ('pending', 'pending_verification', 'processing', 'awaiting_transfer', 'admin_review', 'blocked');

  -- The reset must never have reached a provider_credit (MHC) wallet.
  SELECT count(*) INTO touched_mhc
  FROM public.transactions t
  JOIN public.wallets w ON w.id = t.wallet_id
  WHERE t.reference_type = 'legacy_egp_reset' AND w.account_type <> 'money';

  IF bad_wallets > 0 THEN
    RAISE EXCEPTION 'Legacy EGP reset failed: % money wallet(s) still non-zero or unfrozen', bad_wallets;
  END IF;
  IF bad_funds > 0 THEN
    RAISE EXCEPTION 'Legacy EGP reset failed: % funding-source balance(s) still non-zero', bad_funds;
  END IF;
  IF bad_holds > 0 THEN
    RAISE EXCEPTION 'Legacy EGP reset failed: % wallet hold(s) still held', bad_holds;
  END IF;
  IF bad_deposits > 0 THEN
    RAISE EXCEPTION 'Legacy EGP reset failed: % legacy top-up request(s) still in flight', bad_deposits;
  END IF;
  IF bad_withdraw > 0 THEN
    RAISE EXCEPTION 'Legacy EGP reset failed: % withdrawal request(s) still in flight', bad_withdraw;
  END IF;
  IF touched_mhc > 0 THEN
    RAISE EXCEPTION 'Legacy EGP reset failed: reset touched % non-money wallet(s)', touched_mhc;
  END IF;

  RAISE NOTICE 'Legacy EGP test-wallet reset complete and validated.';
END $$;
