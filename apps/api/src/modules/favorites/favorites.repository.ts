import { getPool } from '../../db/pool.js';

export type FavoriteRow = {
  id: string;
  user_id: string;
  target_type: string;
  target_id: string;
  created_at: string;
};

export class FavoritesRepository {
  async add(userId: string, targetType: string, targetId: string): Promise<FavoriteRow | null> {
    const pool = getPool();
    const { rows } = await pool.query<FavoriteRow>(
      `INSERT INTO favorites (user_id, target_type, target_id)
       VALUES ($1, $2, $3)
       ON CONFLICT (user_id, target_type, target_id) DO NOTHING
       RETURNING id, user_id, target_type, target_id, created_at`,
      [userId, targetType, targetId],
    );
    return rows[0] ?? null;
  }

  async remove(userId: string, targetType: string, targetId: string): Promise<boolean> {
    const pool = getPool();
    const { rowCount } = await pool.query(
      `DELETE FROM favorites WHERE user_id = $1 AND target_type = $2 AND target_id = $3`,
      [userId, targetType, targetId],
    );
    return (rowCount ?? 0) > 0;
  }

  async list(userId: string, targetType?: string): Promise<FavoriteRow[]> {
    const pool = getPool();
    if (targetType) {
      const { rows } = await pool.query<FavoriteRow>(
        `SELECT id, user_id, target_type, target_id, created_at FROM favorites
         WHERE user_id = $1 AND target_type = $2 ORDER BY created_at DESC`,
        [userId, targetType],
      );
      return rows;
    }
    const { rows } = await pool.query<FavoriteRow>(
      `SELECT id, user_id, target_type, target_id, created_at FROM favorites
       WHERE user_id = $1 ORDER BY created_at DESC`,
      [userId],
    );
    return rows;
  }

  async isFavorite(userId: string, targetType: string, targetId: string): Promise<boolean> {
    const pool = getPool();
    const { rows } = await pool.query<{ n: string }>(
      `SELECT 1 AS n FROM favorites WHERE user_id = $1 AND target_type = $2 AND target_id = $3`,
      [userId, targetType, targetId],
    );
    return rows.length > 0;
  }
}
