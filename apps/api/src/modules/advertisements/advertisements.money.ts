const PIASTRES_PER_EGP = 100;
const DAY_MS = 24 * 60 * 60 * 1000;

export const egpToPiastres = (amount: number): number | null => {
  if (!Number.isFinite(amount) || amount < 0) return null;
  const scaled = amount * PIASTRES_PER_EGP;
  const piastres = Math.round(scaled);
  if (Math.abs(scaled - piastres) > 1e-8 || !Number.isSafeInteger(piastres)) return null;
  return piastres;
};

export const computeAdCancellationRefundPiastres = (input: {
  totalPiastres: number;
  durationDays: number;
  startsAtMs: number;
  expiresAtMs: number;
  effectiveNowMs: number;
}): number => {
  if (
    !Number.isSafeInteger(input.totalPiastres) ||
    input.totalPiastres <= 0 ||
    !Number.isSafeInteger(input.durationDays) ||
    input.durationDays <= 0 ||
    ![input.startsAtMs, input.expiresAtMs, input.effectiveNowMs].every(Number.isFinite) ||
    input.expiresAtMs <= input.effectiveNowMs
  ) {
    return 0;
  }
  if (input.startsAtMs >= input.effectiveNowMs) return input.totalPiastres;

  const paidDurationMs = input.durationDays * DAY_MS;
  const remainingMs = Math.min(
    paidDurationMs,
    Math.max(0, input.expiresAtMs - input.effectiveNowMs),
  );
  return Math.min(
    input.totalPiastres,
    Math.floor((input.totalPiastres * remainingMs) / paidDurationMs),
  );
};
