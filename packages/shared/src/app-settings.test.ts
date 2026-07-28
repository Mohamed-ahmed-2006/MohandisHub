import { describe, expect, it } from 'vitest';

import {
  getDefaultPaymentMethodsEnabled,
  isPaymentMethodEnabled,
  isPaymentMethodEnabledStrict,
  LAUNCH_RETIRED_PAYMENT_METHOD_KEYS,
  parsePaymentMethodsEnabled,
  PAYMENT_METHOD_DEFINITIONS,
} from './app-settings.js';

describe('payment method settings — launch model', () => {
  it('defaults every customer-funding and withdrawal rail to disabled', () => {
    // Launch model: customers pay providers DIRECTLY and MHC is not cashable, so
    // the platform holds no job money and opens no deposit/withdrawal rail.
    expect(getDefaultPaymentMethodsEnabled()).toEqual({
      deposit_crypto: false,
      deposit_card: false,
      deposit_instapay: false,
      deposit_paymob: false,
      withdrawal_crypto: false,
      withdrawal_instapay: false,
      withdrawal_paymob: false,
      escrow_bid_payment: false,
      credit_purchase_instapay: true,
      credit_purchase_nowpayments: false,
    });
  });

  it('enables only manual InstaPay MHC purchase by default', () => {
    const enabledByDefault = PAYMENT_METHOD_DEFINITIONS.filter((m) => m.defaultEnabled).map(
      (m) => m.key,
    );
    expect(enabledByDefault).toEqual(['credit_purchase_instapay']);
  });

  it('marks every retired rail as not launch-recommended', () => {
    for (const key of LAUNCH_RETIRED_PAYMENT_METHOD_KEYS) {
      const definition = PAYMENT_METHOD_DEFINITIONS.find((m) => m.key === key);
      expect(definition, `missing definition for ${key}`).toBeDefined();
      expect(definition).toMatchObject({ defaultEnabled: false, launchRecommended: false });
    }
  });

  it('preserves future payment method keys while merging known defaults', () => {
    const parsed = parsePaymentMethodsEnabled(
      { deposit_new_provider: true, withdrawal_new_provider: false },
      { disableCryptoDeposits: false, disableCardDeposits: false },
    );

    expect(parsed.deposit_new_provider).toBe(true);
    expect(parsed.withdrawal_new_provider).toBe(false);
    expect(parsed.credit_purchase_instapay).toBe(true);
  });

  it('treats legacy disable_* columns as one-way OFF switches', () => {
    // Regression guard: these columns must never re-ENABLE a retired rail just
    // because the operator left disable_crypto_deposits = false.
    const parsed = parsePaymentMethodsEnabled(null, {
      disableCryptoDeposits: false,
      disableCardDeposits: false,
    });
    expect(parsed.deposit_crypto).toBe(false);
    expect(parsed.deposit_card).toBe(false);
  });

  it('still allows an explicit stored true to enable a rail (admin opt-in)', () => {
    const parsed = parsePaymentMethodsEnabled(
      { deposit_crypto: true },
      { disableCryptoDeposits: false, disableCardDeposits: false },
    );
    expect(parsed.deposit_crypto).toBe(true);
  });
});

describe('isPaymentMethodEnabledStrict vs isPaymentMethodEnabled', () => {
  it('strict check is fail-CLOSED for a missing key', () => {
    expect(isPaymentMethodEnabledStrict({}, 'escrow_bid_payment')).toBe(false);
    expect(isPaymentMethodEnabledStrict(null, 'escrow_bid_payment')).toBe(false);
    expect(isPaymentMethodEnabledStrict(undefined, 'escrow_bid_payment')).toBe(false);
  });

  it('lenient check is fail-OPEN for a missing key (documents why money paths must not use it)', () => {
    expect(isPaymentMethodEnabled({}, 'escrow_bid_payment')).toBe(true);
  });

  it('both agree when the key is explicitly set', () => {
    expect(isPaymentMethodEnabledStrict({ deposit_crypto: true }, 'deposit_crypto')).toBe(true);
    expect(isPaymentMethodEnabled({ deposit_crypto: true }, 'deposit_crypto')).toBe(true);
    expect(isPaymentMethodEnabledStrict({ deposit_crypto: false }, 'deposit_crypto')).toBe(false);
    expect(isPaymentMethodEnabled({ deposit_crypto: false }, 'deposit_crypto')).toBe(false);
  });
});
