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
});
