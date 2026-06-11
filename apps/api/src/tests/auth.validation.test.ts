import { afterEach, describe, expect, it } from 'vitest';

import { env } from '../config/env.js';
import { hashToken } from '../config/jwt.js';
import { loginSchema } from '../modules/auth/auth.validation.js';

describe('auth validation', () => {
  const originalRefreshSecret = env.JWT_REFRESH_SECRET;

  afterEach(() => {
    env.JWT_REFRESH_SECRET = originalRefreshSecret;
  });

  it('caps login password length before bcrypt comparison work', () => {
    const parsed = loginSchema.safeParse({
      email: 'user@example.com',
      password: 'a'.repeat(129),
    });

    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(parsed.error.flatten().fieldErrors.password?.[0]).toContain('128');
    }
  });

  it('hashes opaque tokens with JWT_REFRESH_SECRET', () => {
    env.JWT_REFRESH_SECRET = 'refresh-secret-a-at-least-32-characters';
    const firstHash = hashToken('same-token-value');

    env.JWT_REFRESH_SECRET = 'refresh-secret-b-at-least-32-characters';
    const secondHash = hashToken('same-token-value');

    expect(firstHash).toMatch(/^[a-f0-9]{64}$/);
    expect(secondHash).toMatch(/^[a-f0-9]{64}$/);
    expect(firstHash).not.toBe(secondHash);
  });
});
