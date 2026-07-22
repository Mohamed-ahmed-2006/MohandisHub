import { describe, expect, it } from 'vitest';

import { parseEgpAmount } from '../modules/wallet/wallet.amount.js';

describe('parseEgpAmount', () => {
  it('accepts positive values with at most two decimal places', () => {
    expect(parseEgpAmount(1)).toBe(1);
    expect(parseEgpAmount('125.50')).toBe(125.5);
    expect(parseEgpAmount(9_999_999_999.99)).toBe(9_999_999_999.99);
  });

  it('rejects malformed, non-finite, non-positive, and excess-precision values', () => {
    for (const value of [
      '',
      '12abc',
      Number.NaN,
      Number.POSITIVE_INFINITY,
      0,
      -1,
      1.001,
      10_000_000_000,
      null,
    ]) {
      expect(parseEgpAmount(value)).toBeNull();
    }
  });
});
