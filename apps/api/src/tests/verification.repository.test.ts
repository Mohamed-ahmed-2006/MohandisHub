import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  connect: vi.fn(),
  clientQuery: vi.fn(),
  release: vi.fn(),
}));

vi.mock('../db/pool.js', () => ({
  getPool: () => ({ query: mocks.query, connect: mocks.connect }),
}));

import { VerificationRepository } from '../modules/verification/verification.repository.js';

describe('VerificationRepository state transitions', () => {
  beforeEach(() => {
    mocks.query.mockReset().mockResolvedValue({ rows: [] });
    mocks.clientQuery.mockReset();
    mocks.release.mockReset();
    mocks.connect.mockReset().mockResolvedValue({
      query: mocks.clientQuery,
      release: mocks.release,
    });
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

  it('rolls back the request when the profile update fails', async () => {
    mocks.clientQuery
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({
        rows: [
          {
            id: 'request-1',
            user_id: 'user-1',
            status: 'submitted',
          },
        ],
      })
      .mockResolvedValueOnce({ rowCount: 1, rows: [] })
      .mockRejectedValueOnce(new Error('profile update failed'))
      .mockResolvedValueOnce({ rows: [] });
    const repo = new VerificationRepository();

    await expect(
      repo.applyTerminalOutcome({
        requestId: 'request-1',
        status: 'approved',
        role: 'expert',
        profileStatus: 'verified',
        identityApproved: true,
        identityVerificationMethod: 'didit',
        auditAction: 'verification.webhook_result',
      }),
    ).rejects.toThrow('profile update failed');

    const statements = mocks.clientQuery.mock.calls.map((call) => String(call[0]));
    expect(statements[0]).toBe('BEGIN');
    expect(statements.at(-1)).toBe('ROLLBACK');
    expect(statements).not.toContain('COMMIT');
    expect(mocks.release).toHaveBeenCalledOnce();
  });

  it('commits request, profile, and audit updates together', async () => {
    mocks.clientQuery
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({
        rows: [{ id: 'request-1', user_id: 'user-1', status: 'submitted' }],
      })
      .mockResolvedValueOnce({ rowCount: 1, rows: [] })
      .mockResolvedValueOnce({ rowCount: 1, rows: [] })
      .mockResolvedValueOnce({ rowCount: 1, rows: [] })
      .mockResolvedValueOnce({ rows: [] });
    const repo = new VerificationRepository();

    await expect(
      repo.applyTerminalOutcome({
        requestId: 'request-1',
        status: 'rejected',
        reviewedBy: 'admin-1',
        role: 'expert',
        profileStatus: 'rejected',
        identityApproved: false,
        auditAction: 'verification.admin_review',
      }),
    ).resolves.toBe(true);

    const statements = mocks.clientQuery.mock.calls.map((call) => String(call[0]));
    expect(statements.some((sql) => sql.includes('INSERT INTO audit_log'))).toBe(true);
    expect(statements.at(-1)).toBe('COMMIT');
  });
});
