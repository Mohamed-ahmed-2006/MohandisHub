import type { WalletFundingAllocation, WalletFundingRail } from '@mohandishub/shared';

export const WALLET_FUNDING_RAILS: WalletFundingRail[] = [
  'crypto',
  'instapay',
  'paymob',
  'card',
  'restricted',
];

export const GENERAL_SPEND_RAIL_ORDER: WalletFundingRail[] = [
  'crypto',
  'instapay',
  'paymob',
  'card',
  'restricted',
];

const toCents = (value: number): number => Math.round((value + Number.EPSILON) * 100);
const fromCents = (value: number): number => value / 100;

export function computeSpendAllocation(
  balances: Partial<Record<WalletFundingRail, number>>,
  amount: number,
  onlyRail?: WalletFundingRail,
): {
  allocation: WalletFundingAllocation;
  availableAmountEgp: number;
  sufficient: boolean;
} {
  const order = onlyRail ? [onlyRail] : GENERAL_SPEND_RAIL_ORDER;
  const availableCents = order.reduce((sum, rail) => sum + toCents(balances[rail] ?? 0), 0);
  const requestedCents = toCents(amount);
  if (availableCents < requestedCents) {
    return {
      allocation: {},
      availableAmountEgp: fromCents(availableCents),
      sufficient: false,
    };
  }

  let remainingCents = requestedCents;
  const allocation: WalletFundingAllocation = {};
  for (const rail of order) {
    if (remainingCents <= 0) break;
    const takeCents = Math.min(toCents(balances[rail] ?? 0), remainingCents);
    if (takeCents <= 0) continue;
    allocation[rail] = fromCents(takeCents);
    remainingCents -= takeCents;
  }
  return {
    allocation,
    availableAmountEgp: fromCents(availableCents),
    sufficient: remainingCents === 0,
  };
}
