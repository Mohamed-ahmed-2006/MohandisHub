import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ query: vi.fn() }));

vi.mock('../db/pool.js', () => ({
  getPool: () => ({ query: mocks.query }),
}));

import { VerificationRepository } from '../modules/verification/verification.repository.js';

describe('VerificationRepository state transitions', () => {
  beforeEach(() => {
    mocks.query.mockReset().mockResolvedValue({ rows: [] });
  });

  it('atomically limits webhook transitions to allowed prior states', async () => {
    mocks.query.mockResolvedValueOnce({ rows: [{ id: 'request-1' }] });
    const repo = new VerificationRepository();

    await expect(
      repo.transitionStatus('request-1', ['initiated', 'submitted'], 'approved', {
        providerResponse: { status: 'Approved' },
      }),
    ).resolves.toBe(true);

    const [sql, values] = mocks.query.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('status::text = ANY($4::text[])');
    expect(sql).toContain('RETURNING id');
    expect(values).toEqual([
      'approved',
      JSON.stringify({ status: 'Approved' }),
      'request-1',
      ['initiated', 'submitted'],
    ]);
  });

  it('clears identity approval when a verification is rejected', async () => {
    const repo = new VerificationRepository();
    await repo.updateProfileVerificationStatus('user-1', 'expert', 'rejected');

    const [sql, values] = mocks.query.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('identity_verified = false');
    expect(sql).toContain('identity_verification_method = NULL');
    expect(values).toEqual(['rejected', 'user-1']);
  });
});
