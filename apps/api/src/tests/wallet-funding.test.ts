import { describe, expect, it } from 'vitest';

import { computeSpendAllocation } from '../modules/wallet/wallet-funding.js';

describe('wallet funding-source allocation', () => {
  it('spends crypto before InstaPay for a general purchase', () => {
    expect(
      computeSpendAllocation({ crypto: 1000, instapay: 1000 }, 500),
    ).toMatchObject({
      sufficient: true,
      allocation: { crypto: 500 },
    });

    expect(
      computeSpendAllocation({ crypto: 1000, instapay: 1000 }, 1500),
    ).toMatchObject({
      sufficient: true,
      allocation: { crypto: 1000, instapay: 500 },
    });
  });

  it('limits withdrawals to the selected rail', () => {
    expect(
      computeSpendAllocation({ crypto: 300, instapay: 700 }, 500, 'crypto'),
    ).toEqual({
      sufficient: false,
      availableAmountEgp: 300,
      allocation: {},
    });
    expect(
      computeSpendAllocation({ crypto: 300, instapay: 700 }, 300, 'crypto'),
    ).toEqual({
      sufficient: true,
      availableAmountEgp: 300,
      allocation: { crypto: 300 },
    });
  });

  it('uses integer cents and never leaks a fractional cent', () => {
    expect(
      computeSpendAllocation({ crypto: 10.01, instapay: 10.01 }, 15.02),
    ).toEqual({
      sufficient: true,
      availableAmountEgp: 20.02,
      allocation: { crypto: 10.01, instapay: 5.01 },
    });
  });
});
