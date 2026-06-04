-- Launch default: Stripe/card deposits are not in use yet.
-- Keep NOWPayments crypto and manual InstaPay rails enabled, and preserve any future keys.
ALTER TABLE app_settings
  ALTER COLUMN payment_methods_enabled SET DEFAULT jsonb_build_object(
    'deposit_crypto', true,
    'deposit_card', false,
    'deposit_instapay', true,
    'withdrawal_crypto', true,
    'withdrawal_instapay', true
  );

UPDATE app_settings
SET payment_methods_enabled =
      COALESCE(payment_methods_enabled, '{}'::jsonb)
      || jsonb_build_object('deposit_card', false),
    disable_card_deposits = true
WHERE COALESCE(payment_methods_enabled ->> 'deposit_card', 'true') = 'true';
