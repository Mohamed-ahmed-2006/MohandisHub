import { describe, expect, it } from 'vitest';

import {
  getDefaultPaymentMethodsEnabled,
  parsePaymentMethodsEnabled,
  PAYMENT_METHOD_DEFINITIONS,
} from './app-settings.js';

describe('payment method settings', () => {
  it('defaults launch rails to NOWPayments crypto and InstaPay while Paymob stays hidden until configured', () => {
    expect(getDefaultPaymentMethodsEnabled()).toEqual({
      deposit_crypto: true,
      deposit_card: false,
      deposit_instapay: true,
      deposit_paymob: false,
      withdrawal_crypto: false,
      withdrawal_instapay: true,
      withdrawal_paymob: false,
    });
    expect(
      PAYMENT_METHOD_DEFINITIONS.find((method) => method.key === 'deposit_card'),
    ).toMatchObject({
      defaultEnabled: false,
      launchRecommended: false,
    });
    expect(
      PAYMENT_METHOD_DEFINITIONS.find((method) => method.key === 'deposit_paymob'),
    ).toMatchObject({
      defaultEnabled: false,
      launchRecommended: false,
    });
    expect(
      PAYMENT_METHOD_DEFINITIONS.find((method) => method.key === 'withdrawal_paymob'),
    ).toMatchObject({
      defaultEnabled: false,
      launchRecommended: false,
    });
    expect(
      PAYMENT_METHOD_DEFINITIONS.find((method) => method.key === 'withdrawal_crypto'),
    ).toMatchObject({
      defaultEnabled: false,
      launchRecommended: false,
    });
  });

  it('preserves future payment method keys while merging known defaults', () => {
    const parsed = parsePaymentMethodsEnabled(
      { deposit_new_provider: true, withdrawal_new_provider: false },
      { disableCryptoDeposits: false, disableCardDeposits: false },
    );

    expect(parsed.deposit_crypto).toBe(true);
    expect(parsed.deposit_card).toBe(false);
    expect(parsed.deposit_new_provider).toBe(true);
    expect(parsed.withdrawal_new_provider).toBe(false);
  });
});
