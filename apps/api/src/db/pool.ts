import { Pool } from 'pg';

import { env } from '../config/env.js';

let pool: Pool | null = null;

export const hasDatabaseConfig = (): boolean => Boolean(env.DATABASE_URL);

export const getPool = (): Pool => {
  if (!env.DATABASE_URL) {
    throw new Error('DATABASE_URL is not configured');
  }

  if (!pool) {
    pool = new Pool({
      connectionString: env.DATABASE_URL,
      max: env.DB_POOL_MAX,
      idleTimeoutMillis: env.DB_IDLE_TIMEOUT_MS,
    });
  }

  return pool;
};

export const closePool = async (): Promise<void> => {
  if (!pool) {
    return;
  }

  await pool.end();
  pool = null;
};
