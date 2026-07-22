import { describe, expect, it } from 'vitest';

import { computeCommissionSplit } from './wallet.js';

describe('computeCommissionSplit', () => {
  it('takes the percentage when it exceeds the flat minimum', () => {
    const { commission, providerAmount } = computeCommissionSplit(1000, 10, 20);
    expect(commission).toBe(100);
    expect(providerAmount).toBe(900);
  });

  it('takes the flat minimum when the percentage is smaller', () => {
    const { commission, providerAmount } = computeCommissionSplit(100, 10, 25);
    expect(commission).toBe(25);
    expect(providerAmount).toBe(75);
  });

  it('never lets commission exceed the amount (provider payout cannot go negative)', () => {
    const { commission, providerAmount } = computeCommissionSplit(10, 10, 50);
    expect(commission).toBe(10);
    expect(providerAmount).toBe(0);
  });

  it('treats invalid/zero/negative amounts as zero', () => {
    expect(computeCommissionSplit(0, 10, 5)).toEqual({ commission: 0, providerAmount: 0 });
    expect(computeCommissionSplit(-100, 10, 5)).toEqual({ commission: 0, providerAmount: 0 });
    expect(computeCommissionSplit(Number.NaN, 10, 5)).toEqual({ commission: 0, providerAmount: 0 });
  });

  it('the platform never receives more than the customer paid', () => {
    for (const amount of [1, 5, 9.99, 50, 1000]) {
      const { commission, providerAmount } = computeCommissionSplit(amount, 10, 20);
      expect(commission).toBeLessThanOrEqual(amount);
      expect(commission + providerAmount).toBeCloseTo(amount, 6);
      expect(providerAmount).toBeGreaterThanOrEqual(0);
    }
  });

  it('rounds once to cents and assigns the remainder to the provider', () => {
    expect(computeCommissionSplit(1, 2.5, 0)).toEqual({
      commission: 0.03,
      providerAmount: 0.97,
    });
    expect(computeCommissionSplit(1, 2.5, 0).commission).not.toBe(0.025);
  });

  it('normalizes invalid commission settings instead of returning NaN or negative values', () => {
    expect(computeCommissionSplit(100, -10, -5)).toEqual({
      commission: 0,
      providerAmount: 100,
    });
    expect(computeCommissionSplit(100, Number.NaN, Number.POSITIVE_INFINITY)).toEqual({
      commission: 0,
      providerAmount: 100,
    });
  });

  it('handles the maximum NUMERIC(12,2)-sized amount without losing cents', () => {
    const split = computeCommissionSplit(9_999_999_999.99, 10, 0);
    expect(split.commission).toBe(1_000_000_000);
    expect(split.providerAmount).toBe(8_999_999_999.99);
    expect(split.commission + split.providerAmount).toBeCloseTo(9_999_999_999.99, 2);
  });
});
