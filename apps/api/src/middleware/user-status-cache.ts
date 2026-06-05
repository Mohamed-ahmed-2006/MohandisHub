// ---------------------------------------------------------------------------
// userStatusCache — short-lived cache of users.is_active / deleted_at
// ---------------------------------------------------------------------------
//
// `authenticate` consults this cache on every request so a deactivated or
// soft-deleted user loses access shortly after the admin action, without a DB
// round-trip on every single request. Entries expire after a short TTL, and
// admin actions (deactivate / force-logout) invalidate entries immediately.

import { getPool } from '../db/pool.js';

type CachedStatus = {
  active: boolean;
  expiresAt: number;
};

const TTL_MS = 60_000;
const cache = new Map<string, CachedStatus>();

/** Remove a user's cached status so the next request re-reads from the DB. */
export const invalidateUserStatusCache = (userId: string): void => {
  cache.delete(userId);
};

/** Clear the entire cache (used in tests). */
export const clearUserStatusCache = (): void => {
  cache.clear();
};

/**
 * Returns true if the user is active (exists, not soft-deleted, is_active).
 * Result is cached for a short TTL to limit DB load.
 */
export const isUserActive = async (userId: string): Promise<boolean> => {
  const now = Date.now();
  const cached = cache.get(userId);
  if (cached && cached.expiresAt > now) {
    return cached.active;
  }

  const { rows } = await getPool().query<{ active: boolean }>(
    `SELECT (deleted_at IS NULL AND COALESCE(is_active, true)) AS active
       FROM users
      WHERE id = $1
      LIMIT 1`,
    [userId],
  );
  const active = rows[0]?.active === true;
  cache.set(userId, { active, expiresAt: now + TTL_MS });
  return active;
};
