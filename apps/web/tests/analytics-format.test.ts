import { describe, expect, it } from 'vitest';

import { formatConversionRate } from '../lib/analytics/format';

describe('analytics formatting', () => {
  it('converts API ratios to percentages', () => {
    expect(formatConversionRate(0.25)).toBe('25.0%');
    expect(formatConversionRate(0.3333)).toBe('33.3%');
    expect(formatConversionRate(2)).toBe('200.0%');
  });

  it('handles zero and missing or invalid rates safely', () => {
    expect(formatConversionRate(0)).toBe('0.0%');
    expect(formatConversionRate(null)).toBe('0.0%');
    expect(formatConversionRate(undefined)).toBe('0.0%');
    expect(formatConversionRate(Number.NaN)).toBe('0.0%');
    expect(formatConversionRate(-0.5)).toBe('0.0%');
  });
});
