-- ============================================================================
-- MohandisHub — MHC activation gate + launch payment model
-- ----------------------------------------------------------------------------
-- Implements the launch revenue model end-to-end:
--
--   1. A customer awarding a bid no longer immediately activates the job.
--      The need enters 'awarded_pending_provider_acceptance'. The provider must
--      accept AND pay the MHC activation price atomically before the job opens.
--
--   2. Until activation, the customer/provider pair may negotiate in bid chat
--      but MUST NOT exchange contact details, attachments, exact addresses, or
--      provider direct-payment details. Those unlock only after activation.
--
--   3. Pending awards expire after an ADMIN-CONFIGURABLE window. On expiry or
--      provider rejection, no MHC is charged and the customer may award someone
--      else.
--
-- MHC is never refunded to money and never leaves the provider_credit account.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. needs: new pending-acceptance state + pending award bookkeeping
-- ---------------------------------------------------------------------------
ALTER TABLE public.needs DROP CONSTRAINT IF EXISTS needs_status_check;
ALTER TABLE public.needs ADD CONSTRAINT needs_status_check
  CHECK (status IN (
    'open',
    'closed',
    'awarded_pending_provider_acceptance',
    'awarded',
    'in_progress',
    'completed'
  ));

ALTER TABLE public.needs
  ADD COLUMN IF NOT EXISTS pending_award_bid_id     UUID,
  ADD COLUMN IF NOT EXISTS pending_award_at         TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS pending_award_expires_at TIMESTAMPTZ,
  -- Set when the provider accepts + pays MHC. This is the single source of
  -- truth for "the job workspace is unlocked".
  ADD COLUMN IF NOT EXISTS activated_at             TIMESTAMPTZ;

-- Only a pending need may carry pending-award bookkeeping.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'chk_needs_pending_award_shape'
      AND conrelid = 'public.needs'::regclass
  ) THEN
    ALTER TABLE public.needs
      ADD CONSTRAINT chk_needs_pending_award_shape
      CHECK (
        status <> 'awarded_pending_provider_acceptance'
        OR (pending_award_bid_id IS NOT NULL AND pending_award_expires_at IS NOT NULL)
      );
  END IF;
END $$;

-- Worker/expiry sweep: find expired pending awards cheaply.
CREATE INDEX IF NOT EXISTS idx_needs_pending_award_expiry
  ON public.needs(pending_award_expires_at)
  WHERE status = 'awarded_pending_provider_acceptance';

-- ---------------------------------------------------------------------------
-- 2. bids: track provider acceptance/rejection of a pending award
-- ---------------------------------------------------------------------------
ALTER TABLE public.bids
  ADD COLUMN IF NOT EXISTS award_offered_at   TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS award_accepted_at  TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS award_rejected_at  TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS award_expired_at   TIMESTAMPTZ;

-- 'awarded_pending' = customer chose this bid, provider has not paid yet.
ALTER TABLE public.bids DROP CONSTRAINT IF EXISTS bids_status_check;
ALTER TABLE public.bids ADD CONSTRAINT bids_status_check
  CHECK (status IN (
    'pending',
    'awarded_pending',
    'accepted',
    'rejected',
    'withdrawn',
    'expired'
  ));

-- ---------------------------------------------------------------------------
-- 3. bid_messages: contact-exchange moderation before activation
-- ---------------------------------------------------------------------------
-- We keep the raw text the sender typed for audit/moderation, and serve a
-- redacted body until the job is activated.
ALTER TABLE public.bid_messages
  ADD COLUMN IF NOT EXISTS contact_redacted   BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS raw_content        TEXT;

-- ---------------------------------------------------------------------------
-- 4. app_settings: admin-configurable acceptance window + gate toggles
-- ---------------------------------------------------------------------------
ALTER TABLE public.app_settings
  -- Hours a provider has to accept + pay before the award expires. 0 = never expire.
  ADD COLUMN IF NOT EXISTS award_acceptance_expiry_hours INTEGER NOT NULL DEFAULT 48,
  -- Master switch for the whole MHC activation gate (kill-switch for incidents).
  ADD COLUMN IF NOT EXISTS mhc_activation_gate_enabled   BOOLEAN NOT NULL DEFAULT true,
  -- Block contact details in pre-activation bid chat.
  ADD COLUMN IF NOT EXISTS block_precontact_sharing      BOOLEAN NOT NULL DEFAULT true;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'chk_app_settings_award_expiry_hours'
      AND conrelid = 'public.app_settings'::regclass
  ) THEN
    ALTER TABLE public.app_settings
      ADD CONSTRAINT chk_app_settings_award_expiry_hours
      CHECK (award_acceptance_expiry_hours >= 0 AND award_acceptance_expiry_hours <= 8760);
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 5. Retire the legacy customer-escrow money model for launch
-- ---------------------------------------------------------------------------
-- Customers now pay providers DIRECTLY. The platform never holds job money.
-- Legacy escrow code stays in the tree but every rail is off. Re-enabling any
-- of these is a deliberate admin action, not a default.
UPDATE public.app_settings
SET payment_methods_enabled =
  COALESCE(payment_methods_enabled, '{}'::jsonb)
  || jsonb_build_object(
    -- Customer wallet funding: OFF (no customer balance at launch).
    'deposit_instapay', false,
    'deposit_crypto',   false,
    'deposit_card',     false,
    'deposit_paymob',   false,
    -- Withdrawals: OFF (nothing to withdraw; MHC is not cashable).
    'withdrawal_instapay', false,
    'withdrawal_crypto',   false,
    'withdrawal_paymob',   false,
    -- Internal customer→provider escrow payment: OFF (retired for launch).
    'escrow_bid_payment', false,
    -- Provider MHC purchase rails.
    'credit_purchase_instapay',    true,
    -- Crypto MHC purchase stays OFF until the IPN path is verified live.
    'credit_purchase_nowpayments', false
  )
WHERE TRUE;

-- Freeze every EGP money wallet so no legacy balance can move at launch.
UPDATE public.wallets
SET is_frozen = true
WHERE account_type = 'money';

-- ---------------------------------------------------------------------------
-- 6. Validate the credit-purchase shape constraint left NOT VALID earlier
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  BEGIN
    ALTER TABLE public.deposit_requests
      VALIDATE CONSTRAINT chk_deposit_requests_credit_purchase_shape;
  EXCEPTION
    WHEN check_violation THEN
      RAISE NOTICE 'Pre-existing deposit_requests rows violate the credit_purchase shape; left NOT VALID for manual cleanup.';
    WHEN undefined_object THEN
      RAISE NOTICE 'Constraint chk_deposit_requests_credit_purchase_shape not present; skipping.';
  END;
END $$;

-- ---------------------------------------------------------------------------
-- 7. provider_payment_methods: uniqueness + activation-scoped disclosure
-- ---------------------------------------------------------------------------
-- A provider should not accumulate duplicate identical rails.
CREATE UNIQUE INDEX IF NOT EXISTS uq_provider_payment_methods_user_type_label
  ON public.provider_payment_methods(user_id, method_type, COALESCE(lower(btrim(label)), ''));

-- Audit trail: who saw which provider payment details, and via which activation.
CREATE TABLE IF NOT EXISTS public.provider_payment_disclosures (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  activation_id      UUID NOT NULL REFERENCES public.mhc_job_activations(id) ON DELETE CASCADE,
  provider_user_id   UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  customer_user_id   UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  disclosed_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_provider_payment_disclosure_activation_customer
  ON public.provider_payment_disclosures(activation_id, customer_user_id);

-- ---------------------------------------------------------------------------
-- 8. Lock down the new tables (backend-only access posture)
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  table_name TEXT;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'provider_payment_disclosures'
  ]
  LOOP
    IF to_regclass(format('public.%I', table_name)) IS NOT NULL THEN
      EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', table_name);
      EXECUTE format('REVOKE ALL ON TABLE public.%I FROM anon, authenticated', table_name);
    END IF;
  END LOOP;
END $$;
