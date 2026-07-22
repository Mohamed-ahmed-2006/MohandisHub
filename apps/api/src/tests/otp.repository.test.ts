import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ query: vi.fn() }));

vi.mock('../db/pool.js', () => ({
  getPool: () => ({ query: mocks.query }),
}));

import { OtpRepository } from '../modules/otp/otp.repository.js';

describe('OtpRepository delivered-code activation', () => {
  beforeEach(() => {
    mocks.query.mockReset().mockResolvedValue({ rows: [{ activated: true }] });
  });

  it('revives the delivered candidate and expires competing codes atomically', async () => {
    const expiresAt = new Date('2026-07-22T12:10:00.000Z');
    const repo = new OtpRepository();

    await expect(repo.activateDeliveredCode('user-1', 'email', 'code-1', expiresAt)).resolves.toBe(
      true,
    );

    const [sql, values] = mocks.query.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('WITH candidate AS');
    expect(sql).toContain('CASE WHEN v.id = $3 THEN $4 ELSE now() END');
    expect(sql).toContain('EXISTS (SELECT 1 FROM candidate)');
    expect(sql).toContain('SELECT EXISTS (SELECT 1 FROM updated WHERE id = $3) AS activated');
    expect(values).toEqual(['user-1', 'email', 'code-1', expiresAt]);
  });
});
