const MAX_NUMERIC_12_2 = 9_999_999_999.99;

/** Parse a positive EGP amount that can be represented exactly as NUMERIC(12,2). */
export function parseEgpAmount(raw: unknown): number | null {
  const value =
    typeof raw === 'number'
      ? raw
      : typeof raw === 'string' && raw.trim() !== ''
        ? Number(raw.trim())
        : Number.NaN;
  if (!Number.isFinite(value) || value <= 0 || value > MAX_NUMERIC_12_2) return null;

  const scaled = value * 100;
  const cents = Math.round(scaled);
  if (Math.abs(scaled - cents) > 1e-8) return null;
  return cents / 100;
}
