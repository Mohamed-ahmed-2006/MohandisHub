import { describe, expect, it } from 'vitest';

import { parseLimit, parsePagination } from '../utils/pagination.js';

describe('strict pagination parsing', () => {
  it('uses endpoint defaults when values are absent', () => {
    expect(parsePagination({}, { defaultLimit: 20, maxLimit: 100 })).toEqual({
      page: 1,
      limit: 20,
      offset: 0,
    });
  });

  it('accepts positive base-10 integers and calculates a safe offset', () => {
    expect(
      parsePagination({ page: '3', limit: '25' }, { defaultLimit: 20, maxLimit: 100 }),
    ).toEqual({ page: 3, limit: 25, offset: 50 });
  });

  it.each([
    { page: '0' },
    { page: '-1' },
    { page: '1.5' },
    { page: '1e2' },
    { page: ' 2' },
    { page: ['2'] },
    { limit: '0' },
    { limit: '101' },
    { limit: 'NaN' },
  ])('rejects invalid input %#', (query) => {
    expect(() => parsePagination(query, { defaultLimit: 20, maxLimit: 100 })).toThrowError(
      expect.objectContaining({ code: 'INVALID_PAGINATION' }),
    );
  });

  it('supports strict limit-only endpoints', () => {
    expect(parseLimit(undefined, { defaultLimit: 10, maxLimit: 20 })).toBe(10);
    expect(() => parseLimit('21', { defaultLimit: 10, maxLimit: 20 })).toThrow();
  });
});
