// ---------------------------------------------------------------------------
// Services repository — database access layer for public service endpoints
// ---------------------------------------------------------------------------

import type { Pool } from 'pg';

import { getPool } from '../../db/pool.js';

type CategoryRow = {
  id: string;
  name_en: string;
  name_ar: string;
  slug: string;
  description_en: string | null;
  description_ar: string | null;
  icon: string | null;
  parent_id: string | null;
  sort_order: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

type ServiceSearchRow = {
  id: string;
  title: string;
  provider_id: string;
  provider_name: string;
  provider_role: string;
  provider_avatar: string | null;
  category_slug: string | null;
  category_name_en: string | null;
  category_name_ar: string | null;
  price: string | null;
  price_type: string;
  city: string | null;
  area: string | null;
  avg_rating: string | null;
  is_featured: boolean;
};

type ServiceDetailRow = {
  id: string;
  provider_id: string;
  category_id: string | null;
  title: string;
  description: string | null;
  price: string | null;
  price_type: string;
  currency: string;
  delivery_time_days: number | null;
  status: string;
  tags: string[];
  images: string[];
  is_featured: boolean;
  view_count: number;
  order_count: number;
  avg_rating: string | null;
  city: string | null;
  area: string | null;
  country: string;
  created_at: string;
  updated_at: string;
};

export class ServicesRepository {
  private get db(): Pool {
    return getPool();
  }

  async listActiveCategories(): Promise<CategoryRow[]> {
    const { rows } = await this.db.query<CategoryRow>(
      `SELECT * FROM service_categories WHERE is_active = true ORDER BY sort_order ASC`,
    );
    return rows;
  }

  async searchServices(
    filters: {
      categoryId?: string;
      city?: string;
      area?: string;
      providerType?: string;
      query?: string;
    },
    page: number,
    limit: number,
  ): Promise<{ rows: ServiceSearchRow[]; total: number }> {
    const conditions: string[] = [`s.status = 'active'`];
    const params: unknown[] = [];
    let idx = 1;

    if (filters.categoryId) {
      conditions.push(`s.category_id = $${idx++}`);
      params.push(filters.categoryId);
    }
    if (filters.city) {
      conditions.push(`s.city ILIKE $${idx++}`);
      params.push(`%${filters.city}%`);
    }
    if (filters.area) {
      conditions.push(`s.area ILIKE $${idx++}`);
      params.push(`%${filters.area}%`);
    }
    if (filters.providerType) {
      conditions.push(`u.primary_role = $${idx++}`);
      params.push(filters.providerType);
    }
    if (filters.query) {
      conditions.push(`(s.title ILIKE $${idx} OR s.description ILIKE $${idx})`);
      params.push(`%${filters.query}%`);
      idx++;
    }

    const where = conditions.join(' AND ');

    const countParams = [...params];
    const countResult = await this.db.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM services s JOIN users u ON u.id = s.provider_id WHERE ${where}`,
      countParams,
    );
    const total = parseInt(countResult.rows[0]!.count, 10);

    const offset = (page - 1) * limit;
    params.push(limit, offset);

    const { rows } = await this.db.query<ServiceSearchRow>(
      `SELECT s.id, s.title, s.provider_id, u.display_name AS provider_name,
              u.primary_role AS provider_role, u.avatar_url AS provider_avatar,
              c.slug AS category_slug, c.name_en AS category_name_en, c.name_ar AS category_name_ar,
              s.price::text, s.price_type, s.city, s.area, s.avg_rating::text, s.is_featured
       FROM services s
       JOIN users u ON u.id = s.provider_id
       LEFT JOIN service_categories c ON c.id = s.category_id
       WHERE ${where}
       ORDER BY s.is_featured DESC, s.created_at DESC
       LIMIT $${idx++} OFFSET $${idx}`,
      params,
    );

    return { rows, total };
  }

  async getServiceById(serviceId: string): Promise<ServiceDetailRow | null> {
    const { rows } = await this.db.query<ServiceDetailRow>(`SELECT * FROM services WHERE id = $1`, [
      serviceId,
    ]);
    return rows[0] ?? null;
  }

  async incrementViewCount(serviceId: string): Promise<void> {
    await this.db.query(`UPDATE services SET view_count = view_count + 1 WHERE id = $1`, [
      serviceId,
    ]);
  }
}

export type { CategoryRow, ServiceSearchRow, ServiceDetailRow };
