-- ============================================================================
-- wallet_funding_sources_and_admin_bulk_actions
-- ----------------------------------------------------------------------------
-- RECOVERED MIGRATION — restored to version control on 2026-07-29.
--
-- This file was applied to the database but was missing from the repository.
-- The SQL below is the ORIGINAL text, recovered verbatim from
-- supabase_migrations.schema_migrations.statements (the statement list the
-- Supabase CLI recorded when it applied this migration). It is NOT a
-- reconstruction from the live schema.
--
-- Statements are re-joined in their recorded execution order. Only the
-- statement separator was re-added; no statement text was altered.
--
-- Applied version: 20260727120000
-- Statements:      24
-- ============================================================================

-- ============================================================================
-- Wallet funding-source conservation + durable admin bulk user operations
-- ============================================================================

ALTER TABLE public.wallets
  ADD COLUMN IF NOT EXISTS source_reconciliation_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (source_reconciliation_status IN ('pending', 'ready', 'review_required')),
  ADD COLUMN IF NOT EXISTS source_reconciled_at TIMESTAMPTZ;

ALTER TABLE public.wallet_holds
  ADD COLUMN IF NOT EXISTS funding_allocations JSONB NOT NULL DEFAULT '{}'::jsonb;

CREATE TABLE IF NOT EXISTS public.wallet_fund_balances (
  wallet_id UUID NOT NULL REFERENCES public.wallets(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  rail TEXT NOT NULL CHECK (rail IN ('crypto', 'instapay', 'paymob', 'card', 'restricted')),
  amount NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (amount >= 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (wallet_id, rail)
);

CREATE INDEX IF NOT EXISTS idx_wallet_fund_balances_user
  ON public.wallet_fund_balances(user_id);

CREATE TABLE IF NOT EXISTS public.wallet_fund_movements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  wallet_id UUID NOT NULL REFERENCES public.wallets(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  rail TEXT NOT NULL CHECK (rail IN ('crypto', 'instapay', 'paymob', 'card', 'restricted')),
  amount_delta NUMERIC(12,2) NOT NULL CHECK (amount_delta <> 0),
  transaction_id UUID REFERENCES public.transactions(id) ON DELETE SET NULL,
  hold_id UUID REFERENCES public.wallet_holds(id) ON DELETE SET NULL,
  reason TEXT NOT NULL,
  event_key TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_wallet_fund_movements_wallet_created
  ON public.wallet_fund_movements(wallet_id, created_at, id);

CREATE INDEX IF NOT EXISTS idx_wallet_fund_movements_transaction
  ON public.wallet_fund_movements(transaction_id);

CREATE INDEX IF NOT EXISTS idx_wallet_fund_movements_hold
  ON public.wallet_fund_movements(hold_id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_wallet_fund_movements_event_rail
  ON public.wallet_fund_movements(wallet_id, event_key, rail)
  WHERE event_key IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.admin_bulk_operations (
  id UUID PRIMARY KEY,
  actor_id UUID NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  action TEXT NOT NULL CHECK (
    action IN (
      'activate',
      'deactivate',
      'soft_delete',
      'force_logout',
      'send_verification_email',
      'verify_email',
      'freeze_wallet',
      'unfreeze_wallet',
      'assign_plan'
    )
  ),
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  request_hash TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'processing'
    CHECK (status IN ('processing', 'completed')),
  requested_count INTEGER NOT NULL CHECK (requested_count BETWEEN 1 AND 100),
  succeeded_count INTEGER NOT NULL DEFAULT 0,
  skipped_count INTEGER NOT NULL DEFAULT 0,
  failed_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_admin_bulk_operations_actor_created
  ON public.admin_bulk_operations(actor_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.admin_bulk_operation_items (
  operation_id UUID NOT NULL REFERENCES public.admin_bulk_operations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'processing', 'succeeded', 'skipped', 'failed')),
  code TEXT,
  message TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (operation_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_admin_bulk_operation_items_status
  ON public.admin_bulk_operation_items(operation_id, status);

-- Seed all rails for every wallet. New wallets are initialized by application code.
INSERT INTO public.wallet_fund_balances (wallet_id, user_id, rail, amount)
SELECT w.id, w.user_id, r.rail, 0
FROM public.wallets w
CROSS JOIN (
  VALUES ('crypto'), ('instapay'), ('paymob'), ('card'), ('restricted')
) AS r(rail)
ON CONFLICT (wallet_id, rail) DO NOTHING;

-- Zero-value wallets are unambiguous and ready immediately.
UPDATE public.wallets
SET source_reconciliation_status = 'ready',
    source_reconciled_at = now()
WHERE balance = 0;

-- Conservatively replay non-zero histories. Direct deposits retain their provider
-- rail; debits use the launch policy (crypto, then InstaPay, then other/restricted).
-- Internal credits that predate source tracking are marked for finance review.
DO $$
DECLARE
  wallet_row RECORD;
  tx RECORD;
  crypto_balance NUMERIC(12,2);
  instapay_balance NUMERIC(12,2);
  paymob_balance NUMERIC(12,2);
  card_balance NUMERIC(12,2);
  restricted_balance NUMERIC(12,2);
  remaining NUMERIC(12,2);
  take_amount NUMERIC(12,2);
  ambiguous BOOLEAN;
BEGIN
  FOR wallet_row IN
    SELECT id, user_id, balance
    FROM public.wallets
    WHERE balance <> 0
  LOOP
    crypto_balance := 0;
    instapay_balance := 0;
    paymob_balance := 0;
    card_balance := 0;
    restricted_balance := 0;
    ambiguous := false;

    FOR tx IN
      SELECT type, balance_delta, reference_type
      FROM public.transactions
      WHERE wallet_id = wallet_row.id
        AND status IN ('completed', 'reversed')
        AND balance_delta IS NOT NULL
      ORDER BY created_at, id
    LOOP
      IF tx.balance_delta > 0 THEN
        IF tx.type = 'deposit' AND tx.reference_type IN ('nowpayments', 'cryptomus') THEN
          crypto_balance := crypto_balance + tx.balance_delta;
        ELSIF tx.type = 'deposit' AND tx.reference_type = 'instapay_manual' THEN
          instapay_balance := instapay_balance + tx.balance_delta;
        ELSIF tx.type = 'deposit' AND tx.reference_type = 'paymob' THEN
          paymob_balance := paymob_balance + tx.balance_delta;
        ELSIF tx.type = 'deposit' AND tx.reference_type = 'stripe' THEN
          card_balance := card_balance + tx.balance_delta;
        ELSE
          restricted_balance := restricted_balance + tx.balance_delta;
          ambiguous := true;
        END IF;
      ELSIF tx.balance_delta < 0 THEN
        remaining := ABS(tx.balance_delta);

        take_amount := LEAST(crypto_balance, remaining);
        crypto_balance := crypto_balance - take_amount;
        remaining := remaining - take_amount;

        take_amount := LEAST(instapay_balance, remaining);
        instapay_balance := instapay_balance - take_amount;
        remaining := remaining - take_amount;

        take_amount := LEAST(paymob_balance, remaining);
        paymob_balance := paymob_balance - take_amount;
        remaining := remaining - take_amount;

        take_amount := LEAST(card_balance, remaining);
        card_balance := card_balance - take_amount;
        remaining := remaining - take_amount;

        take_amount := LEAST(restricted_balance, remaining);
        restricted_balance := restricted_balance - take_amount;
        remaining := remaining - take_amount;

        IF remaining > 0 THEN
          ambiguous := true;
        END IF;
      END IF;
    END LOOP;

    UPDATE public.wallet_fund_balances
    SET amount = CASE rail
      WHEN 'crypto' THEN crypto_balance
      WHEN 'instapay' THEN instapay_balance
      WHEN 'paymob' THEN paymob_balance
      WHEN 'card' THEN card_balance
      ELSE restricted_balance
    END,
    updated_at = now()
    WHERE wallet_id = wallet_row.id;

    IF ROUND(
      crypto_balance + instapay_balance + paymob_balance + card_balance + restricted_balance,
      2
    ) <> ROUND(wallet_row.balance, 2) THEN
      ambiguous := true;
    END IF;

    UPDATE public.wallets
    SET source_reconciliation_status =
          CASE WHEN ambiguous THEN 'review_required' ELSE 'ready' END,
        source_reconciled_at = now()
    WHERE id = wallet_row.id;

    INSERT INTO public.wallet_fund_movements (
      wallet_id, user_id, rail, amount_delta, reason, event_key, metadata
    )
    SELECT
      wallet_row.id,
      wallet_row.user_id,
      rail,
      amount,
      'Historical funding-source backfill',
      'source-backfill-v1',
      jsonb_build_object('ambiguous', ambiguous)
    FROM public.wallet_fund_balances
    WHERE wallet_id = wallet_row.id
      AND amount > 0
    ON CONFLICT DO NOTHING;
  END LOOP;
END $$;

ALTER TABLE public.wallet_fund_balances ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.wallet_fund_movements ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.admin_bulk_operations ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.admin_bulk_operation_items ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.wallet_fund_balances FROM anon, authenticated;

REVOKE ALL ON TABLE public.wallet_fund_movements FROM anon, authenticated;

REVOKE ALL ON TABLE public.admin_bulk_operations FROM anon, authenticated;

REVOKE ALL ON TABLE public.admin_bulk_operation_items FROM anon, authenticated;
