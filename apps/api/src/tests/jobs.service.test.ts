import { beforeEach, describe, expect, it, vi } from 'vitest';

import { JobsService } from '../modules/jobs/jobs.service.js';
import type { JobApplicationRow, JobRow } from '../modules/jobs/jobs.repository.js';

const queryMock = vi.fn();
const releaseMock = vi.fn();
const connectMock = vi.fn(async () => ({
  query: queryMock,
  release: releaseMock,
}));

vi.mock('../db/pool.js', () => ({
  getPool: () => ({
    connect: connectMock,
  }),
}));

const makeJob = (overrides: Partial<JobRow> = {}): JobRow => ({
  id: 'job-1',
  business_id: 'business-1',
  title: 'Job',
  description: 'Job description',
  requirements: null,
  salary_range: null,
  status: 'open',
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
  ...overrides,
});

const makeApp = (overrides: Partial<JobApplicationRow> = {}): JobApplicationRow => ({
  id: 'app-1',
  job_id: 'job-1',
  expert_id: 'expert-1',
  cover_letter: null,
  status: 'pending',
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
  ...overrides,
});

describe('JobsService hardening', () => {
  beforeEach(() => {
    queryMock.mockReset();
    releaseMock.mockReset();
    connectMock.mockClear();
  });

  it('blocks milestone creation for non-accepted applications', async () => {
    const repo = {
      getApplicationById: vi.fn().mockResolvedValue(makeApp({ status: 'pending' })),
      getJobById: vi.fn().mockResolvedValue(makeJob()),
    };
    const service = new JobsService(repo as never);

    await expect(
      service.createMilestone('app-1', 'business-1', { title: 'M1', amount: 50 }),
    ).rejects.toMatchObject({
      code: 'APPLICATION_NOT_ACCEPTED',
    });
  });

  it('blocks application chat for rejected applications', async () => {
    const repo = {
      getApplicationById: vi.fn().mockResolvedValue(makeApp({ status: 'rejected' })),
      getJobById: vi.fn().mockResolvedValue(makeJob()),
    };
    const service = new JobsService(repo as never);

    await expect(service.getApplicationMessages('app-1', 'business-1')).rejects.toMatchObject({
      code: 'APPLICATION_CHAT_NOT_ALLOWED',
    });
  });

  it('blocks accepted-app replacement after work has started', async () => {
    queryMock
      .mockResolvedValueOnce({}) // BEGIN
      .mockResolvedValueOnce({ rows: [makeApp({ id: 'app-target', status: 'pending' })] }) // app FOR UPDATE
      .mockResolvedValueOnce({ rows: [makeJob()] }) // job FOR UPDATE
      .mockResolvedValueOnce({
        rows: [
          makeApp({ id: 'app-target', status: 'pending' }),
          makeApp({ id: 'app-current', status: 'accepted' }),
        ],
      }) // apps FOR UPDATE
      .mockResolvedValueOnce({ rows: [{ started: true }] }) // work started check
      .mockResolvedValueOnce({}); // ROLLBACK

    const repo = {};
    const service = new JobsService(repo as never);

    await expect(
      service.updateApplicationStatus('app-target', 'business-1', 'accepted'),
    ).rejects.toMatchObject({
      code: 'APPLICATION_REPLACEMENT_BLOCKED',
    });
  });
});
