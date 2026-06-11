-- First-class payment reconciliation uniqueness for provider callbacks.
CREATE UNIQUE INDEX IF NOT EXISTS uq_deposit_requests_paymob_order_id
  ON public.deposit_requests(paymob_order_id)
  WHERE paymob_order_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_deposit_requests_paymob_transaction_id
  ON public.deposit_requests(paymob_transaction_id)
  WHERE paymob_transaction_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_deposit_requests_provider_payment_id
  ON public.deposit_requests(provider, provider_payment_id)
  WHERE provider_payment_id IS NOT NULL;
