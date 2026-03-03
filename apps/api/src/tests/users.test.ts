import type { ApiErrorBody, ApiSuccessBody } from '@mohandishub/shared';
import request from 'supertest';
import { describe, expect, it } from 'vitest';

import { createApp } from '../app.js';
import type { UserSummary } from '../modules/users/users.types.js';

describe('users module', () => {
  it('returns users list', async () => {
    const app = createApp();

    const response = await request(app).get('/api/users');
    const body = response.body as ApiSuccessBody<UserSummary[]>;

    expect(response.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(Array.isArray(body.data)).toBe(true);
    expect(body.data.length).toBeGreaterThan(0);
  });

  it('returns 404 envelope for unknown user', async () => {
    const app = createApp();

    const response = await request(app).get('/api/users/unknown_user');
    const body = response.body as ApiErrorBody;

    expect(response.status).toBe(404);
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe('USER_NOT_FOUND');
    expect(body.error.message).toContain('unknown_user');
    expect(body.error.requestId).toBeTypeOf('string');
  });
});
