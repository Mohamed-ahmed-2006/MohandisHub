import type { Favorite, FavoriteTargetType } from '@mohandishub/shared';

import type { FavoriteRow } from './favorites.repository.js';
import { FavoritesRepository } from './favorites.repository.js';

export class FavoritesService {
  constructor(private readonly repo: FavoritesRepository = new FavoritesRepository()) {}

  private toFavorite(row: FavoriteRow): Favorite {
    return {
      id: row.id,
      userId: row.user_id,
      targetType: row.target_type as FavoriteTargetType,
      targetId: row.target_id,
      createdAt: row.created_at,
    };
  }

  async add(
    userId: string,
    targetType: FavoriteTargetType,
    targetId: string,
  ): Promise<Favorite | null> {
    const row = await this.repo.add(userId, targetType, targetId);
    return row ? this.toFavorite(row) : null;
  }

  async remove(userId: string, targetType: FavoriteTargetType, targetId: string): Promise<boolean> {
    return this.repo.remove(userId, targetType, targetId);
  }

  async list(userId: string, targetType?: FavoriteTargetType): Promise<Favorite[]> {
    const rows = await this.repo.list(userId, targetType);
    return rows.map((r) => this.toFavorite(r));
  }

  async isFavorite(
    userId: string,
    targetType: FavoriteTargetType,
    targetId: string,
  ): Promise<boolean> {
    return this.repo.isFavorite(userId, targetType, targetId);
  }
}
