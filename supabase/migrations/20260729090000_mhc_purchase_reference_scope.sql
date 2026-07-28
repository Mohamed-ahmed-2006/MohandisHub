-- ============================================================================
-- MHC purchase transfer-reference uniqueness — correct the scope
-- ----------------------------------------------------------------------------
-- 20260728120000 created:
--
--   uq_deposit_requests_instapay_reference
--     ON deposit_requests(provider, lower(btrim(transfer_reference)))
--     WHERE transfer_reference IS NOT NULL AND provider = 'instapay_manual'
--
-- The intent was "a provider cannot submit the same InstaPay transfer twice to
-- buy credits". The predicate is wider than that intent: provider =
-- 'instapay_manual' is ALSO used by the legacy manual wallet top-up rail, whose
-- transfer_reference column was added in 20260627120000. Two unrelated problems
-- follow:
--
--   1. Migration safety. The index spans historical top-up rows. Any pre-existing
--      duplicate reference makes CREATE UNIQUE INDEX abort, taking the whole
--      migration with it.
--   2. Behaviour. A legacy top-up reference would block an unrelated MHC purchase
--      that happens to reuse the same bank reference string, surfacing as a
--      confusing MHC_TRANSFER_REFERENCE_ALREADY_USED.
--
-- Bank references are not globally unique across banks, so admin review stays the
-- real authority. This index only needs to stop a provider re-submitting the same
-- reference for credits, which is exactly purpose = 'credit_purchase'.
--
-- Non-destructive: drops and recreates an index only. No data is touched.
-- ============================================================================

DROP INDEX IF EXISTS public.uq_deposit_requests_instapay_reference;

CREATE UNIQUE INDEX IF NOT EXISTS uq_deposit_requests_credit_purchase_reference
  ON public.deposit_requests(provider, lower(btrim(transfer_reference)))
  WHERE transfer_reference IS NOT NULL
    AND provider = 'instapay_manual'
    AND purpose = 'credit_purchase';
