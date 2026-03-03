import { getPool, hasDatabaseConfig } from './pool.js';

export const pingDb = async (): Promise<boolean> => {
  if (!hasDatabaseConfig()) {
    return false;
  }

  const pool = getPool();
  const result = await pool.query('SELECT 1');

  return result.rowCount === 1;
};
