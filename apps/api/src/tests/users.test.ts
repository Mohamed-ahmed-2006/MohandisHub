import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../modules/settings/settings.repository.js', () => ({
  SettingsRepository: vi.fn(function SettingsRepositoryMock() {
    return { get: vi.fn().mockResolvedValue(null) };
  }),
}));

import { createApp } from '../app.js';

describe('users module', () => {
  it('does not expose the legacy seeded users list', async () => {
    const app = createApp();

    const response = await request(app).get('/api/users');

    expect(response.status).toBe(404);
  }, 15_000);

  it('does not expose legacy seeded user details', async () => {
    const app = createApp();

    const response = await request(app).get('/api/users/unknown_user');

    expect(response.status).toBe(404);
  }, 15_000);
});
