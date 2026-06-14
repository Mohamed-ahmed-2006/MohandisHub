import type { SavedSearch } from '@mohandishub/shared';
import type { Pool } from 'pg';

import { getPool } from '../../db/pool.js';

import type { UpsertSavedSearchInput } from './saved-searches.validation.js';

type SavedSearchRow = {
  id: string;
  kind: 'service' | 'need';
  name: string;
  filters: Record<string, unknown>;
  locale: string;
  result_count_snapshot: number;
  last_viewed_at: Date | null;
  created_at: Date;
  updated_at: Date;
};

const toSavedSearch = (row: SavedSearchRow): SavedSearch => ({
  id: row.id,
  kind: row.kind,
  name: row.name,
  filters: row.filters,
  locale: row.locale,
  resultCountSnapshot: row.result_count_snapshot,
  lastViewedAt: row.last_viewed_at?.toISOString() ?? null,
  createdAt: row.created_at.toISOString(),
  updatedAt: row.updated_at.toISOString(),
});

export class SavedSearchesRepository {
  constructor(private readonly db: Pool = getPool()) {}

  async list(userId: string, kind?: 'service' | 'need'): Promise<SavedSearch[]> {
    const params: unknown[] = [userId];
    const kindClause = kind ? 'AND kind = $2' : '';
    if (kind) params.push(kind);
    const { rows } = await this.db.query<SavedSearchRow>(
      `SELECT id, kind, name, filters, locale, result_count_snapshot, last_viewed_at, created_at, updated_at
       FROM saved_searches
       WHERE user_id = $1 ${kindClause}
       ORDER BY updated_at DESC`,
      params,
    );
    return rows.map(toSavedSearch);
  }

  async create(
    userId: string,
    input: UpsertSavedSearchInput,
    resultCount = 0,
  ): Promise<SavedSearch> {
    const { rows } = await this.db.query<SavedSearchRow>(
      `INSERT INTO saved_searches (user_id, kind, name, filters, locale, result_count_snapshot)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, kind, name, filters, locale, result_count_snapshot, last_viewed_at, created_at, updated_at`,
      [
        userId,
        input.kind,
        input.name,
        JSON.stringify(input.filters ?? {}),
        input.locale ?? 'en',
        resultCount,
      ],
    );
    if (!rows[0]) throw new Error('Saved search create failed');
    return toSavedSearch(rows[0]);
  }

  async update(
    userId: string,
    id: string,
    input: UpsertSavedSearchInput,
  ): Promise<SavedSearch | null> {
    const { rows } = await this.db.query<SavedSearchRow>(
      `UPDATE saved_searches
       SET kind = $3, name = $4, filters = $5, locale = $6, updated_at = now()
       WHERE user_id = $1 AND id = $2
       RETURNING id, kind, name, filters, locale, result_count_snapshot, last_viewed_at, created_at, updated_at`,
      [
        userId,
        id,
        input.kind,
        input.name,
        JSON.stringify(input.filters ?? {}),
        input.locale ?? 'en',
      ],
    );
    return rows[0] ? toSavedSearch(rows[0]) : null;
  }

  async markViewed(userId: string, id: string, resultCount: number): Promise<SavedSearch | null> {
    const { rows } = await this.db.query<SavedSearchRow>(
      `UPDATE saved_searches
       SET last_viewed_at = now(), result_count_snapshot = $3, updated_at = now()
       WHERE user_id = $1 AND id = $2
       RETURNING id, kind, name, filters, locale, result_count_snapshot, last_viewed_at, created_at, updated_at`,
      [userId, id, Math.max(0, resultCount)],
    );
    return rows[0] ? toSavedSearch(rows[0]) : null;
  }

  async delete(userId: string, id: string): Promise<boolean> {
    const { rowCount } = await this.db.query(
      `DELETE FROM saved_searches WHERE user_id = $1 AND id = $2`,
      [userId, id],
    );
    return (rowCount ?? 0) > 0;
  }
}
