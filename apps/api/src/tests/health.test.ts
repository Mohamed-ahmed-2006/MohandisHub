import type { HealthResponse } from '@mohandishub/shared';
import request from 'supertest';
import { describe, expect, it } from 'vitest';

import { createApp } from '../app.js';

describe('GET /health', () => {
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
});
