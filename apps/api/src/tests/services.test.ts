import request from 'supertest';
import { describe, expect, it } from 'vitest';

import { createApp } from '../app.js';

describe('GET /api/services/catalog', () => {
  it('returns categories and services with role visibility', async () => {
    const app = createApp();

    const response = await request(app).get('/api/services/catalog');

    expect(response.status).toBe(200);
    expect(response.body.ok).toBe(true);
    expect(Array.isArray(response.body.data.categories)).toBe(true);
    expect(Array.isArray(response.body.data.services)).toBe(true);
    expect(response.body.data.categories.length).toBeGreaterThan(0);
    expect(response.body.data.services.length).toBeGreaterThan(0);

    for (const category of response.body.data.categories as Array<{ roleVisibility: unknown }>) {
      expect(Array.isArray(category.roleVisibility)).toBe(true);
    }

    for (const service of response.body.data.services as Array<{ roleVisibility: unknown }>) {
      expect(Array.isArray(service.roleVisibility)).toBe(true);
    }
  });
});
