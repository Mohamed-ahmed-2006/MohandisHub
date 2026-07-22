import { afterEach, describe, expect, it, vi } from 'vitest';

const makeUserRow = (avatarUrl: string | null) => ({
  id: 'user-1',
  email: 'user@example.com',
  password_hash: 'hash',
  phone: null,
  phone_code: null,
  nationality: null,
  display_name: 'User One',
  avatar_url: avatarUrl,
  date_of_birth: null,
  primary_role: 'expert',
  is_admin: false,
  admin_permissions: [],
  plan_id: null,
  plan_slug: 'free',
  plan_limits: null,
  email_verified_at: new Date(),
  phone_verified_at: null,
  is_active: true,
  created_at: new Date(),
  updated_at: new Date(),
});

describe('AuthRepository.updateUser', () => {
  afterEach(() => {
    vi.resetModules();
    vi.doUnmock('../db/pool.js');
  });

  it('persists avatarUrl to users.avatar_url and returns it', async () => {
    const avatarUrl = 'https://cdn.example.com/avatar.png';
    const query = vi.fn((sql: string, values: unknown[]) => {
      if (sql.startsWith('UPDATE users SET')) {
        expect(sql).toContain('avatar_url = $1');
        expect(values).toEqual([avatarUrl, 'user-1']);
        return Promise.resolve({ rows: [] });
      }

      if (sql.includes('FROM users u')) {
        expect(values).toEqual(['user-1']);
        return Promise.resolve({ rows: [makeUserRow(avatarUrl)] });
      }

      throw new Error(`Unexpected query: ${sql}`);
    });

    vi.doMock('../db/pool.js', () => ({
      getPool: () => ({ query }),
    }));

    const { AuthRepository } = await import('../modules/auth/auth.repository.js');
    const repo = new AuthRepository();
    const user = await repo.updateUser('user-1', { avatarUrl });

    expect(user?.avatar_url).toBe(avatarUrl);
    expect(query).toHaveBeenCalledTimes(2);
  });

  it('consumes a password reset token in the same statement that updates the password', async () => {
    const query = vi.fn((sql: string, values: unknown[]) => {
      expect(sql).toContain('UPDATE users');
      expect(sql).toContain('password_hash = $2');
      expect(sql).toContain('password_reset_token = NULL');
      expect(sql).toContain('password_reset_expires > now()');
      expect(sql).toContain('RETURNING id');
      expect(values).toEqual(['token-hash', 'new-password-hash']);
      return Promise.resolve({ rows: [{ id: 'user-1' }] });
    });

    vi.doMock('../db/pool.js', () => ({
      getPool: () => ({ query }),
    }));

    const { AuthRepository } = await import('../modules/auth/auth.repository.js');
    const repo = new AuthRepository();
    await expect(repo.resetPasswordWithToken('token-hash', 'new-password-hash')).resolves.toBe(
      'user-1',
    );
    expect(query).toHaveBeenCalledTimes(1);
  });
});
