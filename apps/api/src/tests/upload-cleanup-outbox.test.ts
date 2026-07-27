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

import {
  completeStorageDeletionJob,
  markUploadObjectFailed,
  retryStorageDeletionJob,
  type StorageDeletionJob,
} from '../modules/upload/upload.repository.js';

const job: StorageDeletionJob = {
  id: '11111111-1111-4111-8111-111111111111',
  upload_object_id: '22222222-2222-4222-8222-222222222222',
  attempts: 2,
  bucket: 'private-uploads',
  storage_path: 'users/user-1/random.pdf',
};

describe('upload storage-deletion outbox', () => {
  beforeEach(() => {
    mocks.query.mockReset().mockResolvedValue({ rows: [] });
    mocks.clientQuery.mockReset();
    mocks.release.mockReset();
    mocks.connect.mockReset().mockResolvedValue({
      query: mocks.clientQuery,
      release: mocks.release,
    });
  });

  it('rolls back the upload state when enqueueing cleanup fails', async () => {
    mocks.clientQuery
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rowCount: 1, rows: [] })
      .mockRejectedValueOnce(new Error('outbox insert failed'))
      .mockResolvedValueOnce({ rows: [] });

    await expect(markUploadObjectFailed(job.upload_object_id, true)).rejects.toThrow(
      'outbox insert failed',
    );

    const statements = mocks.clientQuery.mock.calls.map((call) => String(call[0]));
    expect(statements[0]).toBe('BEGIN');
    expect(statements.at(-1)).toBe('ROLLBACK');
    expect(statements).not.toContain('COMMIT');
    expect(mocks.release).toHaveBeenCalledOnce();
  });

  it('does not mark the object deleted if completing the outbox job fails', async () => {
    mocks.clientQuery
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rowCount: 1, rows: [] })
      .mockRejectedValueOnce(new Error('job completion failed'))
      .mockResolvedValueOnce({ rows: [] });

    await expect(completeStorageDeletionJob(job)).rejects.toThrow('job completion failed');

    const statements = mocks.clientQuery.mock.calls.map((call) => String(call[0]));
    expect(statements[0]).toBe('BEGIN');
    expect(statements.at(-1)).toBe('ROLLBACK');
    expect(statements).not.toContain('COMMIT');
  });

  it('schedules a bounded retry and marks exhausted jobs terminal', async () => {
    await expect(retryStorageDeletionJob(job, 'temporary provider error', 8)).resolves.toBe(false);
    expect(mocks.query).toHaveBeenCalledWith(expect.stringContaining('SET state = $2'), [
      job.id,
      'pending',
      60,
      'temporary provider error',
    ]);

    await expect(
      retryStorageDeletionJob({ ...job, attempts: 8 }, 'terminal provider error', 8),
    ).resolves.toBe(true);
    expect(mocks.query).toHaveBeenLastCalledWith(expect.stringContaining('SET state = $2'), [
      job.id,
      'failed',
      3600,
      'terminal provider error',
    ]);
  });
});
