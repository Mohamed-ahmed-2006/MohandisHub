import type { HealthResponse } from '@mohandishub/shared';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createApp } from '../app.js';
import type * as PoolModule from '../db/pool.js';

const { hasDatabaseConfigMock, pingDbMock } = vi.hoisted(() => ({
  hasDatabaseConfigMock: vi.fn(),
  pingDbMock: vi.fn(),
}));

vi.mock('../db/pool.js', async (importOriginal) => {
  const actual = await importOriginal<typeof PoolModule>();
  return {
    ...actual,
    hasDatabaseConfig: hasDatabaseConfigMock,
  };
});

vi.mock('../db/health.js', () => ({
  pingDb: pingDbMock,
}));

describe('GET /health', () => {
  beforeEach(() => {
    hasDatabaseConfigMock.mockReset();
    pingDbMock.mockReset();
    hasDatabaseConfigMock.mockReturnValue(false);
  });

  it('returns ok true', async () => {
    const app = createApp();

    const response = await request(app).get('/health');
    const body = response.body as HealthResponse;

    expect(response.status).toBe(200);
    expect(body.ok).toBe(true);
    if ('database' in body) {
      expect(typeof body.database).toBe('boolean');
    }
  });

  it('returns 503 on /health/ready when DATABASE_URL is not configured', async () => {
    const app = createApp();
    const response = await request(app).get('/health/ready');

    expect(response.status).toBe(503);
    expect(response.body).toMatchObject({
      ok: false,
      ready: false,
      database: false,
    });
  });
});
