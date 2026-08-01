import { describe, expect, it } from 'vitest';

import type { MhcPurchase, ProviderPaymentMethod } from '@/lib/mhc/client';
import {
  describePaymentMethod,
  describePurchaseState,
  formatMhc,
  formatPackagePrice,
  formatTimeRemaining,
  isPurchaseInFlight,
} from '@/lib/mhc/presentation';

const purchase = (over: Partial<MhcPurchase>): MhcPurchase =>
  ({
    id: 'p1',
    order_id: 'MHC-IP-1',
    status: 'pending_review',
    provider: 'instapay_manual',
    mhc_grant_amount: '100',
    external_price_amount: '250',
    external_price_currency: 'EGP',
    ...over,
  }) as MhcPurchase;

describe('MHC is never presented as money', () => {
  it('labels a balance as MHC, not a currency', () => {
    const formatted = formatMhc(1250, 'en');
    expect(formatted).toContain('MHC');
    expect(formatted).not.toMatch(/EGP|£|\$/);
  });

  it('labels a balance in Arabic without a currency symbol', () => {
    const formatted = formatMhc(1250, 'ar');
    expect(formatted).toContain('نقطة');
    expect(formatted).not.toMatch(/EGP|£|\$|ج\.م/);
  });

  it('handles a string amount and a non-numeric amount safely', () => {
    expect(formatMhc('40.5', 'en')).toContain('40.5');
    expect(formatMhc(Number.NaN, 'en')).toContain('0');
  });

  it('DOES show a currency for the real-money package price', () => {
    // The package price is money the provider actually pays, so it must look
    // like money — unlike the credits it buys.
    expect(formatPackagePrice('250', 'EGP', 'en')).toMatch(/EGP|£/);
  });
});

describe('purchase states', () => {
  it.each([
    ['pending_review', 'pending'],
    ['paid', 'success'],
    ['rejected', 'error'],
    ['failed', 'error'],
    ['expired', 'error'],
    ['cancelled', 'neutral'],
  ] as const)('maps %s to the %s tone', (status, tone) => {
    expect(describePurchaseState(purchase({ status }), 'en').tone).toBe(tone);
  });

  it('surfaces an amount mismatch as under review, not as awaiting payment', () => {
    // A NOWPayments purchase that settled for the wrong amount stays `pending`
    // while carrying this provider_status. Showing "awaiting payment" would tell
    // the provider to pay again.
    const state = describePurchaseState(
      purchase({ status: 'pending', provider_status: 'amount_mismatch_review' }),
      'en',
    );
    expect(state.tone).toBe('pending');
    expect(state.label).toMatch(/review/i);
    expect(state.hint).toMatch(/does not match/i);
  });

  it('tells a crypto buyer to finish checkout, and a manual buyer to wait', () => {
    expect(
      describePurchaseState(purchase({ status: 'pending', provider: 'nowpayments' }), 'en').hint,
    ).toMatch(/checkout/i);
    expect(
      describePurchaseState(purchase({ status: 'pending', provider: 'instapay_manual' }), 'en')
        .hint,
    ).toMatch(/confirmation/i);
  });

  it('shows the admin rejection reason when there is one', () => {
    const state = describePurchaseState(
      purchase({ status: 'rejected', rejection_reason: 'No matching transfer found' }),
      'en',
    );
    expect(state.hint).toBe('No matching transfer found');
  });

  it('provides Arabic labels for every state', () => {
    for (const status of ['pending', 'pending_review', 'paid', 'rejected', 'failed'] as const) {
      const state = describePurchaseState(purchase({ status }), 'ar');
      expect(state.label).toMatch(/[؀-ۿ]/);
    }
  });

  it('identifies which purchases are still in flight', () => {
    expect(isPurchaseInFlight('pending')).toBe(true);
    expect(isPurchaseInFlight('pending_review')).toBe(true);
    expect(isPurchaseInFlight('paid')).toBe(false);
    expect(isPurchaseInFlight('rejected')).toBe(false);
  });
});

describe('award offer expiry', () => {
  const now = Date.parse('2026-07-29T12:00:00Z');

  it('returns null when the offer never expires', () => {
    expect(formatTimeRemaining(null, 'en', now)).toBeNull();
    expect(formatTimeRemaining('infinity', 'en', now)).toBeNull();
  });

  it('reports an elapsed offer as expired', () => {
    expect(formatTimeRemaining('2026-07-29T11:00:00Z', 'en', now)).toBe('Expired');
    expect(formatTimeRemaining('2026-07-29T11:00:00Z', 'ar', now)).toBe('منتهي');
  });

  it('formats hours, minutes, and days', () => {
    expect(formatTimeRemaining('2026-07-29T14:30:00Z', 'en', now)).toBe('2h 30m');
    expect(formatTimeRemaining('2026-07-29T12:45:00Z', 'en', now)).toBe('45m');
    expect(formatTimeRemaining('2026-07-31T12:00:00Z', 'en', now)).toBe('2d');
  });
});

describe('payment method display', () => {
  const method = (over: Partial<ProviderPaymentMethod>): ProviderPaymentMethod => ({
    id: 'pm1',
    methodType: 'instapay',
    label: null,
    details: {},
    sortOrder: 0,
    ...over,
  });

  it('shows the InstaPay address and account holder', () => {
    const lines = describePaymentMethod(
      method({
        methodType: 'instapay',
        details: { instapayAddress: 'ahmed@instapay', accountHolderName: 'Ahmed Ali' },
      }),
      'en',
    );
    expect(lines).toEqual([
      { label: 'Account holder', value: 'Ahmed Ali' },
      { label: 'InstaPay address', value: 'ahmed@instapay' },
    ]);
  });

  it('translates the mobile wallet provider name', () => {
    const lines = describePaymentMethod(
      method({
        methodType: 'mobile_wallet',
        details: {
          walletProvider: 'vodafone_cash',
          phoneNumber: '01012345678',
          accountHolderName: 'Ahmed Ali',
        },
      }),
      'ar',
    );
    expect(lines.some((l) => l.value === 'فودافون كاش')).toBe(true);
    expect(lines.some((l) => l.value === '01012345678')).toBe(true);
  });

  it('omits absent optional bank fields rather than rendering blanks', () => {
    const lines = describePaymentMethod(
      method({
        methodType: 'bank_transfer',
        details: {
          bankName: 'CIB',
          accountHolderName: 'Ahmed Ali',
          iban: 'EG380019000500000000263180002',
        },
      }),
      'en',
    );
    expect(lines.map((l) => l.label)).toEqual(['Account holder', 'Bank', 'IBAN']);
  });

  it('ignores unexpected keys in details', () => {
    // The API strips unknown keys, but the UI must not render them even if a
    // legacy row still carries some.
    const lines = describePaymentMethod(
      method({
        methodType: 'instapay',
        details: {
          instapayAddress: 'a@instapay',
          accountHolderName: 'Ahmed',
          note: 'send elsewhere instead',
        },
      }),
      'en',
    );
    expect(JSON.stringify(lines)).not.toContain('send elsewhere');
  });

  it('renders nothing for an empty details object', () => {
    expect(describePaymentMethod(method({ details: {} }), 'en')).toEqual([]);
  });
});
