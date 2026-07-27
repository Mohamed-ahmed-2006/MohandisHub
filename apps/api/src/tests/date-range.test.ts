import { describe, expect, it } from 'vitest';

import { parseAnalyticsDateRange } from '../utils/date-range.js';

const NOW = new Date('2026-07-27T12:00:00.000Z');

describe('analytics date range validation', () => {
  it('builds the default trailing range', () => {
    const result = parseAnalyticsDateRange({}, NOW);
    expect(result.to.toISOString()).toBe(NOW.toISOString());
    expect(result.from.toISOString()).toBe('2026-06-27T12:00:00.000Z');
  });

  it.each([
    { days: '0' },
    { days: '1e2' },
    { days: '367' },
    { from: 'not-a-date' },
    { from: '2026-07-28T00:00:00Z', to: '2026-07-27T00:00:00Z' },
    { from: '2025-01-01', to: '2026-07-27' },
    { to: '2026-07-28T12:00:00Z' },
  ])('rejects unsafe range %#', (query) => {
    expect(() => parseAnalyticsDateRange(query, NOW)).toThrowError(
      expect.objectContaining({ code: 'INVALID_DATE_RANGE' }),
    );
  });

  it('accepts leap-day ISO dates', () => {
    const result = parseAnalyticsDateRange({ from: '2024-02-29', to: '2024-03-01' }, NOW);
    expect(result.from.toISOString()).toBe('2024-02-29T00:00:00.000Z');
  });
});
