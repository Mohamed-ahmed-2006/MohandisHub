import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ query: vi.fn() }));

vi.mock('../db/pool.js', () => ({
  getPool: () => ({ query: mocks.query }),
}));

import { ReviewsRepository } from '../modules/reviews/reviews.repository.js';

describe('ReviewsRepository rating aggregates', () => {
  beforeEach(() => {
    mocks.query.mockReset();
  });

  it('excludes moderated hidden reviews from both average and count', async () => {
    mocks.query
      .mockResolvedValueOnce({ rows: [{ avg: '4.5' }] })
      .mockResolvedValueOnce({ rows: [{ count: '2' }] });
    const repo = new ReviewsRepository();

    await expect(repo.getAvgRating('user-1', 'expert')).resolves.toBe(4.5);
    await expect(repo.getReviewCount('user-1', 'expert')).resolves.toBe(2);

    const avgSql = mocks.query.mock.calls[0]?.[0] as string;
    const countSql = mocks.query.mock.calls[1]?.[0] as string;
    expect(avgSql).toContain('hidden IS NOT TRUE');
    expect(countSql).toContain('hidden IS NOT TRUE');
  });
});
