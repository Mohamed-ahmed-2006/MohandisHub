import type { ApiErrorBody } from '@mohandishub/shared';
import request from 'supertest';
import { describe, expect, it } from 'vitest';

import { createApp } from '../app.js';

describe('users module', () => {
  it('requires auth for users list', async () => {
    const app = createApp();

    const response = await request(app).get('/api/users');
    const body = response.body as ApiErrorBody;

    expect(response.status).toBe(401);
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe('UNAUTHORIZED');
  });

  it('requires auth for user details', async () => {
    const app = createApp();

    const response = await request(app).get('/api/users/unknown_user');
    const body = response.body as ApiErrorBody;

    expect(response.status).toBe(401);
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe('UNAUTHORIZED');
    expect(body.error.requestId).toBeTypeOf('string');
  });
});
