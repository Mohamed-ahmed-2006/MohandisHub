import { computeCommissionSplit, type ReservationPricingBreakdown } from '@mohandishub/shared';

const PIASTER_PER_EGP = 100;

const toMoney = (value: number): number => Math.round(value * PIASTER_PER_EGP) / PIASTER_PER_EGP;

export interface CustomDisputeSplitAmounts {
  refundAmount: number;
  providerReleaseAmount: number;
}

const toNonnegativePiastres = (amount: number): number | null => {
  if (!Number.isFinite(amount) || amount < 0) return null;
  const scaled = amount * PIASTER_PER_EGP;
  const piastres = Math.round(scaled);
  if (Math.abs(scaled - piastres) > 1e-8) return null;
  return Number.isSafeInteger(piastres) ? piastres : null;
};

/**
 * Normalize a custom dispute split to integer piastres and require it to
 * account for the entire held amount. Returning null keeps invalid money out
 * of the capture-and-credit transaction.
 */
export const normalizeCustomDisputeSplit = (
  holdAmount: number,
  customerRefundAmount: number,
  providerReleaseAmount: number,
): CustomDisputeSplitAmounts | null => {
  const holdPiastres = toNonnegativePiastres(holdAmount);
  const refundPiastres = toNonnegativePiastres(customerRefundAmount);
  const providerPiastres = toNonnegativePiastres(providerReleaseAmount);

  if (
    holdPiastres == null ||
    holdPiastres <= 0 ||
    refundPiastres == null ||
    refundPiastres <= 0 ||
    providerPiastres == null ||
    providerPiastres <= 0 ||
    refundPiastres + providerPiastres !== holdPiastres
  ) {
    return null;
  }

  return {
    refundAmount: refundPiastres / PIASTER_PER_EGP,
    providerReleaseAmount: providerPiastres / PIASTER_PER_EGP,
  };
};

export const resolveReservationCommissionRates = (
  pricing: ReservationPricingBreakdown | null | undefined,
  fallbackPercent: number,
  fallbackMinEgp: number,
): { commissionPercent: number; commissionMinEgp: number } => ({
  commissionPercent:
    pricing?.commissionPercent != null && Number.isFinite(pricing.commissionPercent)
      ? pricing.commissionPercent
      : fallbackPercent,
  commissionMinEgp:
    pricing?.commissionMinEgp != null && Number.isFinite(pricing.commissionMinEgp)
      ? pricing.commissionMinEgp
      : fallbackMinEgp,
});

export const computeFixedReservationPayoutSplit = (input: {
  heldAmount: number;
  platformFeeAmount: number;
  pricing: ReservationPricingBreakdown | null | undefined;
  fallbackCommissionPercent: number;
  fallbackCommissionMinEgp: number;
}): { commission: number; providerAmount: number } => {
  const heldAmount = toMoney(Math.max(0, input.heldAmount));
  const platformFee = toMoney(Math.min(heldAmount, Math.max(0, input.platformFeeAmount)));
  const providerGross = toMoney(Math.max(0, heldAmount - platformFee));
  const platformFundedAmount = toMoney(input.pricing?.couponPlatformFundedAmount ?? 0);
  const originalAmount = toMoney(
    (input.pricing?.originalServicePriceAmount ?? 0) +
      (input.pricing?.originalReservationPriceAmount ?? 0),
  );
  const { commissionPercent, commissionMinEgp } = resolveReservationCommissionRates(
    input.pricing,
    input.fallbackCommissionPercent,
    input.fallbackCommissionMinEgp,
  );

  if (!input.pricing?.couponRedemptionId || originalAmount <= 0) {
    const split = computeCommissionSplit(providerGross, commissionPercent, commissionMinEgp);
    const commission = toMoney(Math.min(heldAmount, split.commission + platformFee));
    return {
      commission,
      providerAmount: toMoney(Math.max(0, heldAmount - commission)),
    };
  }

  const originalSplit = computeCommissionSplit(originalAmount, commissionPercent, commissionMinEgp);
  const serviceCommission = toMoney(Math.max(0, originalSplit.commission - platformFundedAmount));
  const commission = toMoney(Math.min(heldAmount, serviceCommission + platformFee));
  return {
    commission,
    providerAmount: toMoney(Math.max(0, heldAmount - commission)),
  };
};
