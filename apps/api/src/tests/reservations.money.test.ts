import { describe, expect, it } from 'vitest';

import {
  computeFixedReservationPayoutSplit,
  normalizeCustomDisputeSplit,
} from '../modules/reservations/reservations.money.js';

describe('custom reservation dispute split conservation', () => {
  it('accepts an exact cent-safe allocation of the held amount', () => {
    expect(normalizeCustomDisputeSplit(100, 40, 60)).toEqual({
      refundAmount: 40,
      providerReleaseAmount: 60,
    });
    expect(normalizeCustomDisputeSplit(100, 33.33, 66.67)).toEqual({
      refundAmount: 33.33,
      providerReleaseAmount: 66.67,
    });
  });

  it('rejects under-allocation that would destroy captured escrow value', () => {
    expect(normalizeCustomDisputeSplit(100, 40, 40)).toBeNull();
  });

  it('rejects over-allocation that would create value', () => {
    expect(normalizeCustomDisputeSplit(100, 0, 100.01)).toBeNull();
  });

  it('requires full refund and release cases to use their explicit outcomes', () => {
    expect(normalizeCustomDisputeSplit(100, 100, 0)).toBeNull();
    expect(normalizeCustomDisputeSplit(100, 0, 100)).toBeNull();
  });

  it('rejects invalid and unsafe boundary values', () => {
    expect(normalizeCustomDisputeSplit(100, -1, 101)).toBeNull();
    expect(normalizeCustomDisputeSplit(100, 33.333, 66.667)).toBeNull();
    expect(normalizeCustomDisputeSplit(100, Number.NaN, 100)).toBeNull();
    expect(normalizeCustomDisputeSplit(100, Number.POSITIVE_INFINITY, 0)).toBeNull();
    expect(normalizeCustomDisputeSplit(Number.MAX_SAFE_INTEGER, 1, 1)).toBeNull();
  });
});

describe('funded reservation payout snapshots', () => {
  it('uses the commission rate captured when the reservation was funded', () => {
    expect(
      computeFixedReservationPayoutSplit({
        heldAmount: 105,
        platformFeeAmount: 5,
        pricing: {
          servicePriceAmount: 100,
          reservationPriceAmount: 0,
          commissionPercent: 10,
          commissionMinEgp: 0,
          totalAmount: 105,
          currency: 'EGP',
          deductionTiming: 'on_reserve_hold',
          releaseTiming: 'on_completion_or_policy',
          explanation: 'test',
        },
        fallbackCommissionPercent: 90,
        fallbackCommissionMinEgp: 99,
      }),
    ).toEqual({ commission: 15, providerAmount: 90 });
  });

  it('preserves exact cents and the full held value', () => {
    const split = computeFixedReservationPayoutSplit({
      heldAmount: 1.05,
      platformFeeAmount: 0.05,
      pricing: {
        servicePriceAmount: 1,
        reservationPriceAmount: 0,
        commissionPercent: 2.5,
        commissionMinEgp: 0,
        totalAmount: 1.05,
        currency: 'EGP',
        deductionTiming: 'on_reserve_hold',
        releaseTiming: 'on_completion_or_policy',
        explanation: 'test',
      },
      fallbackCommissionPercent: 50,
      fallbackCommissionMinEgp: 0,
    });
    expect(split).toEqual({ commission: 0.08, providerAmount: 0.97 });
    expect(split.commission + split.providerAmount).toBe(1.05);
  });
});
