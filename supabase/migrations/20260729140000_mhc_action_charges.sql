-- ============================================================================
-- MohandisHub — generic MHC action charge ledger
-- ----------------------------------------------------------------------------
-- Backlog P0-07. Today only award and booking ACTIVATION charges MHC, and the
-- record of that charge is `mhc_job_activations` — a table whose row doubles as
-- the contact-unlock gate. Every other intended revenue point (advertisements,
-- subscriptions, bid submission, spotlight, paid tools) has no equivalent record
-- to be idempotent against, which is why none of them charge credits today.
--
-- This table is that record, for actions that are NOT activations. It holds one
-- row per (action, business reference) that has been paid for in MHC.
--
-- What this table is NOT:
--   * It is not a project payment. MohandisHub never holds job money; customers
--     pay providers directly, off platform. Nothing here is EGP.
--   * It is not an escrow, a hold, or a commission record. There are deliberately
--     no money columns, no wallet_holds reference, and no percentage fields.
--   * It is not the activation gate. `mhc_job_activations` keeps that job and is
--     untouched by this migration.
--
-- The ledger of record for the credit movement itself remains `transactions`
-- (wallets.account_type = 'provider_credit', asset_code = 'MHC'). A row here
-- points at the ledger row that debited the provider, and — once refunded — at
-- the ledger row that credited them back. Balances are never adjusted without a
-- transactions row on both legs.
--
-- Zero-price actions deliberately write NO row: nothing was charged, so there is
-- nothing to be idempotent about and nothing to refund. The consumer's own
-- business row (the ad, the bid) is the record that the action happened.
--
-- ----------------------------------------------------------------------------
-- ROLLBACK (tested on a scratch replay database, see the P0-07 report):
--
--   DROP TABLE IF EXISTS public.mhc_action_charges;
--
-- The table is new, nothing references it, and no existing object is altered by
-- this migration — so the DROP is the complete and only reversal. It destroys
-- charge records, so before running it in an environment that has charged
-- anything, export the table: the `transactions` rows survive the DROP and stay
-- the authoritative financial history either way.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 0. Prerequisites — fail loudly rather than half-creating a financial table
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF to_regclass('public.transactions') IS NULL THEN
    RAISE EXCEPTION 'public.transactions is missing; apply the wallet/transaction migrations first.';
  END IF;
  IF to_regclass('public.mhc_action_prices') IS NULL THEN
    RAISE EXCEPTION 'public.mhc_action_prices is missing; apply 20260728120000_mhc_credits_foundation.sql first.';
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 1. The charge record
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.mhc_action_charges (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- The provider account whose MHC was spent. RESTRICT, not CASCADE: this is a
  -- financial record and matches how `transactions.user_id` already behaves.
  -- (`mhc_job_activations` cascades because it is a gate marker, not a ledger.)
  user_id               UUID NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  -- Key into mhc_action_prices. Not an FK: prices are admin-editable and a
  -- deleted price row must never erase the record that a provider was charged.
  action_key            VARCHAR(80) NOT NULL,
  -- The business entity the charge was for, e.g. ('advertisement', <ad id>).
  -- Deliberately loose: consumers live in other modules and adding an FK per
  -- consumer would make this table depend on every one of them.
  reference_type        VARCHAR(80) NOT NULL,
  reference_id          UUID NOT NULL,
  mhc_charged           NUMERIC(14,2) NOT NULL CHECK (mhc_charged >= 0),
  transaction_id        UUID REFERENCES public.transactions(id) ON DELETE RESTRICT,
  -- Caller-supplied retry token. Scoped per (user_id, action_key) by the index
  -- below so two unrelated providers cannot collide on the same string.
  idempotency_key       VARCHAR(200),
  refunded_at           TIMESTAMPTZ,
  refund_transaction_id UUID REFERENCES public.transactions(id) ON DELETE RESTRICT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- A refund ledger row can only exist against a charge marked refunded. The
  -- converse is allowed: a zero-value charge can be closed without a ledger row
  -- because no credits move.
  CONSTRAINT chk_mhc_action_charge_refund_shape
    CHECK (refund_transaction_id IS NULL OR refunded_at IS NOT NULL)
);

COMMENT ON TABLE public.mhc_action_charges IS
  'Generic MHC (platform credit) charges for paid provider actions — ads, subscriptions, '
  'bid fees, promotions, paid tools. NOT project payments: MohandisHub never holds job '
  'money and no column here is denominated in EGP. Award/booking activation charges are '
  'recorded separately in mhc_job_activations and are not duplicated here.';

COMMENT ON COLUMN public.mhc_action_charges.action_key IS
  'mhc_action_prices.action_key the price was read from at charge time.';
COMMENT ON COLUMN public.mhc_action_charges.reference_id IS
  'Id of the business entity charged for. Unique per (action_key, reference_type).';
COMMENT ON COLUMN public.mhc_action_charges.mhc_charged IS
  'MHC actually debited. Always > 0 for rows written by the charging primitive: a '
  'zero-price action writes no row at all.';
COMMENT ON COLUMN public.mhc_action_charges.transaction_id IS
  'The provider_credit ledger row that performed the debit.';
COMMENT ON COLUMN public.mhc_action_charges.idempotency_key IS
  'Optional caller retry token, unique per (user_id, action_key). Reusing it returns '
  'the original charge instead of creating a second one.';
COMMENT ON COLUMN public.mhc_action_charges.refund_transaction_id IS
  'The provider_credit ledger row that credited the refund back. Balances are never '
  'adjusted without one.';

-- ---------------------------------------------------------------------------
-- 2. Idempotency — enforced by the database, not by application logic
-- ---------------------------------------------------------------------------
-- The natural key. Two concurrent submissions for the same ad, bid or
-- subscription collide here rather than double-charging. This is the same
-- structural-idempotency posture as uq_mhc_activation_award.
CREATE UNIQUE INDEX IF NOT EXISTS uq_mhc_action_charge_reference
  ON public.mhc_action_charges(action_key, reference_type, reference_id);

-- Secondary retry key. Scoped to (user_id, action_key) ON PURPOSE: a bare unique
-- index on idempotency_key alone would let one provider's client-generated
-- string block a completely unrelated provider's charge.
CREATE UNIQUE INDEX IF NOT EXISTS uq_mhc_action_charge_idempotency
  ON public.mhc_action_charges(user_id, action_key, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 3. Read paths
-- ---------------------------------------------------------------------------
-- "What has this provider been charged for?" — provider credit history.
CREATE INDEX IF NOT EXISTS idx_mhc_action_charges_user
  ON public.mhc_action_charges(user_id, created_at DESC);

-- "Was this entity charged for, and how much?" — consumer lookups that do not
-- know the action key (e.g. an admin inspecting one advertisement).
CREATE INDEX IF NOT EXISTS idx_mhc_action_charges_reference
  ON public.mhc_action_charges(reference_type, reference_id);

-- Refund sweeps: e.g. "every bid fee on a need that expired unawarded".
-- Partial, because a swept row is refunded once and never revisited.
CREATE INDEX IF NOT EXISTS idx_mhc_action_charges_unrefunded
  ON public.mhc_action_charges(action_key, created_at)
  WHERE refunded_at IS NULL;

-- Ledger audit: walk from a transactions row back to what it paid for.
CREATE INDEX IF NOT EXISTS idx_mhc_action_charges_transaction
  ON public.mhc_action_charges(transaction_id)
  WHERE transaction_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 4. Backend-only access posture
-- ---------------------------------------------------------------------------
-- Same lockdown as every other financial table added since 20260610132000: the
-- API service role is the only reader. No PostgREST client ever sees this.
DO $$
BEGIN
  IF to_regclass('public.mhc_action_charges') IS NOT NULL THEN
    EXECUTE 'ALTER TABLE public.mhc_action_charges ENABLE ROW LEVEL SECURITY';
    EXECUTE 'REVOKE ALL ON TABLE public.mhc_action_charges FROM anon, authenticated';
  END IF;
END $$;
