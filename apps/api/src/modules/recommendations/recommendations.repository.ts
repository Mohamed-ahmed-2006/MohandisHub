import type { RecommendationConsent, RecommendationEventType } from '@mohandishub/shared';
import type { Pool } from 'pg';

import { getPool } from '../../db/pool.js';

export class RecommendationsRepository {
  constructor(private readonly db: Pool = getPool()) {}

  async deleteExpiredEvents(): Promise<number> {
    const { rowCount } = await this.db.query(
      `DELETE FROM recommendation_events
       WHERE created_at < now() - interval '180 days'`,
    );
    return rowCount ?? 0;
  }

  async getConsent(userId: string): Promise<RecommendationConsent> {
    const { rows } = await this.db.query<{
      personalized_enabled: boolean;
      updated_at: Date | null;
    }>(
      `SELECT personalized_enabled, updated_at
       FROM recommendation_preferences
       WHERE user_id = $1`,
      [userId],
    );
    return {
      personalizedRecommendationsEnabled: rows[0]?.personalized_enabled ?? false,
      updatedAt: rows[0]?.updated_at?.toISOString() ?? null,
    };
  }

  async setConsent(userId: string, enabled: boolean): Promise<RecommendationConsent> {
    const { rows } = await this.db.query<{
      personalized_enabled: boolean;
      updated_at: Date;
    }>(
      `INSERT INTO recommendation_preferences (user_id, personalized_enabled)
       VALUES ($1, $2)
       ON CONFLICT (user_id)
       DO UPDATE SET personalized_enabled = EXCLUDED.personalized_enabled, updated_at = now()
       RETURNING personalized_enabled, updated_at`,
      [userId, enabled],
    );
    if (!enabled) await this.deleteEvents(userId);
    return {
      personalizedRecommendationsEnabled: rows[0]?.personalized_enabled ?? enabled,
      updatedAt: rows[0]?.updated_at?.toISOString() ?? new Date().toISOString(),
    };
  }

  async recordEvent(
    userId: string,
    input: {
      eventType: RecommendationEventType;
      serviceId?: string;
      categoryId?: string;
      city?: string;
      metadata?: Record<string, unknown>;
    },
  ): Promise<void> {
    await this.deleteExpiredEvents();
    const consent = await this.getConsent(userId);
    if (!consent.personalizedRecommendationsEnabled) return;
    await this.db.query(
      `INSERT INTO recommendation_events (user_id, event_type, service_id, category_id, city, metadata)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        userId,
        input.eventType,
        input.serviceId ?? null,
        input.categoryId ?? null,
        input.city ?? null,
        JSON.stringify(input.metadata ?? {}),
      ],
    );
  }

  async getTopCategory(userId: string): Promise<string | null> {
    const { rows } = await this.db.query<{ category_id: string | null }>(
      `SELECT category_id
       FROM recommendation_events
       WHERE user_id = $1 AND category_id IS NOT NULL
       GROUP BY category_id
       ORDER BY count(*) DESC, max(created_at) DESC
       LIMIT 1`,
      [userId],
    );
    return rows[0]?.category_id ?? null;
  }

  async deleteEvents(userId: string): Promise<number> {
    const { rowCount } = await this.db.query(
      `DELETE FROM recommendation_events WHERE user_id = $1`,
      [userId],
    );
    return rowCount ?? 0;
  }
}
