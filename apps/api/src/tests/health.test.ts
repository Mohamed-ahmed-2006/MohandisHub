import request from 'supertest';
import { describe, expect, it } from 'vitest';

import { createApp } from '../app.js';

describe('GET /health', () => {
  it('returns ok true', async () => {
    const app = createApp();

    const response = await request(app).get('/health');

    expect(response.status).toBe(200);
    expect(response.body.ok).toBe(true);
    if ('database' in response.body) {
      expect(typeof response.body.database).toBe('boolean');
    }
  });
});
