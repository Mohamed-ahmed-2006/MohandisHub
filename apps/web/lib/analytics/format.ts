export function formatConversionRate(rate: number | null | undefined): string {
  if (rate == null || !Number.isFinite(rate) || rate < 0) return '0.0%';
  return `${(rate * 100).toFixed(1)}%`;
}
