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
  provider_verified: boolean;
  category_slug: string | null;
  category_name_en: string | null;
  category_name_ar: string | null;
  price: string | null;
  currency: string;
  price_type: string;
  is_negotiable: boolean;
  city: string | null;
  area: string | null;
  avg_rating: string | null;
  is_featured: boolean;
  images: string[];
};

type ServiceDetailRow = {
  id: string;
  provider_id: string;
  category_id: string | null;
  title: string;
  description: string | null;
  price: string | null;
  price_type: string;
  is_negotiable: boolean;
  currency: string;
  delivery_time_days: number | null;
  status: string;
  rejection_reason: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
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
      minRating?: number;
      minPrice?: number;
      maxPrice?: number;
      verifiedOnly?: boolean;
      sort?: string;
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
    if (filters.minRating != null && filters.minRating > 0) {
      conditions.push(`s.avg_rating >= $${idx++}`);
      params.push(filters.minRating);
    }
    if (filters.minPrice != null && filters.minPrice >= 0) {
      conditions.push(`s.price >= $${idx++}`);
      params.push(filters.minPrice);
    }
    if (filters.maxPrice != null && filters.maxPrice >= 0) {
      conditions.push(`s.price <= $${idx++}`);
      params.push(filters.maxPrice);
    }
    if (filters.verifiedOnly === true) {
      conditions.push('u.platform_verified_at IS NOT NULL');
    }

    const where = conditions.join(' AND ');

    const countParams = [...params];
    const countResult = await this.db.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM services s JOIN users u ON u.id = s.provider_id LEFT JOIN service_categories c ON c.id = s.category_id WHERE ${where}`,
      countParams,
    );
    const total = parseInt(countResult.rows[0]!.count, 10);

    const sortMap: Record<string, string> = {
      newest: 's.created_at DESC',
      rating: 's.avg_rating DESC NULLS LAST, s.created_at DESC',
      price_asc: 's.price ASC NULLS LAST, s.created_at DESC',
      price_desc: 's.price DESC NULLS LAST, s.created_at DESC',
      completed_count: 's.order_count DESC NULLS LAST, s.created_at DESC',
    };
    const orderClause = sortMap[filters.sort ?? ''] ?? 's.is_featured DESC, s.created_at DESC';

    const offset = (page - 1) * limit;
    params.push(limit, offset);

    const { rows } = await this.db.query<ServiceSearchRow>(
      `SELECT s.id, s.title, s.provider_id, u.display_name AS provider_name,
              u.primary_role AS provider_role, u.avatar_url AS provider_avatar,
              (u.platform_verified_at IS NOT NULL) AS provider_verified,
              c.slug AS category_slug, c.name_en AS category_name_en, c.name_ar AS category_name_ar,
              s.price::text, s.currency, s.price_type, s.is_negotiable, s.city, s.area, s.avg_rating::text, s.is_featured,
              COALESCE(s.images, ARRAY[]::text[]) AS images
       FROM services s
       JOIN users u ON u.id = s.provider_id
       LEFT JOIN service_categories c ON c.id = s.category_id
       WHERE ${where}
       ORDER BY ${orderClause}
       LIMIT $${idx++} OFFSET $${idx}`,
      params,
    );

    return { rows, total };
  }

  /** Rule-based recommendations: top-rated active services, optionally by category. */
  async getRecommendedServices(
    limit: number = 10,
    categoryId?: string,
  ): Promise<ServiceSearchRow[]> {
    const conditions: string[] = ["s.status = 'active'"];
    const params: unknown[] = [];
    let idx = 1;
    if (categoryId) {
      conditions.push(`s.category_id = $${idx++}`);
      params.push(categoryId);
    }
    params.push(limit);
    const { rows } = await this.db.query<ServiceSearchRow>(
      `SELECT s.id, s.title, s.provider_id, u.display_name AS provider_name,
              u.primary_role AS provider_role, u.avatar_url AS provider_avatar,
              (u.platform_verified_at IS NOT NULL) AS provider_verified,
              c.slug AS category_slug, c.name_en AS category_name_en, c.name_ar AS category_name_ar,
              s.price::text, s.currency, s.price_type, s.is_negotiable, s.city, s.area, s.avg_rating::text, s.is_featured,
              COALESCE(s.images, ARRAY[]::text[]) AS images
       FROM services s
       JOIN users u ON u.id = s.provider_id
       LEFT JOIN service_categories c ON c.id = s.category_id
       WHERE ${conditions.join(' AND ')}
       ORDER BY s.avg_rating DESC NULLS LAST, s.order_count DESC NULLS LAST, s.created_at DESC
       LIMIT $${idx}`,
      params,
    );
    return rows;
  }

  async getServiceById(serviceId: string): Promise<ServiceDetailRow | null> {
    const { rows } = await this.db.query<ServiceDetailRow>(`SELECT * FROM services WHERE id = $1`, [
      serviceId,
    ]);
    return rows[0] ?? null;
  }

  async getActiveServiceById(serviceId: string): Promise<ServiceDetailRow | null> {
    const { rows } = await this.db.query<ServiceDetailRow>(
      `SELECT * FROM services WHERE id = $1 AND status = 'active'`,
      [serviceId],
    );
    return rows[0] ?? null;
  }

  async recordView(serviceId: string, viewerHash: string): Promise<boolean> {
    const result = await this.db.query(
      `WITH inserted AS (
         INSERT INTO service_view_events (service_id, viewer_hash, view_bucket)
         VALUES (
           $1,
           $2,
           date_bin(interval '30 minutes', now(), timestamptz '2000-01-01 00:00:00+00')
         )
         ON CONFLICT (service_id, viewer_hash, view_bucket) DO NOTHING
         RETURNING 1
       )
       UPDATE services
          SET view_count = view_count + 1
        WHERE id = $1 AND EXISTS (SELECT 1 FROM inserted)`,
      [serviceId, viewerHash],
    );
    return (result.rowCount ?? 0) === 1;
  }

  async createService(
    providerId: string,
    input: {
      title: string;
      description?: string;
      categoryId?: string;
      price?: number;
      priceType?: string;
      isNegotiable?: boolean;
      currency?: string;
      deliveryTimeDays?: number;
      tags?: string[];
      images?: string[];
      city?: string;
      area?: string;
      country?: string;
      status?: string;
    },
  ): Promise<ServiceDetailRow> {
    const fields = ['provider_id', 'title'];
    const values: unknown[] = [providerId, input.title];
    if (input.description !== undefined) {
      fields.push('description');
      values.push(input.description);
    }
    if (input.categoryId !== undefined) {
      fields.push('category_id');
      values.push(input.categoryId);
    }
    if (input.price !== undefined) {
      fields.push('price');
      values.push(input.price);
    }
    if (input.priceType !== undefined) {
      fields.push('price_type');
      values.push(input.priceType);
    }
    if (input.isNegotiable !== undefined) {
      fields.push('is_negotiable');
      values.push(input.isNegotiable);
    }
    if (input.currency !== undefined) {
      fields.push('currency');
      values.push(input.currency);
    }
    if (input.deliveryTimeDays !== undefined) {
      fields.push('delivery_time_days');
      values.push(input.deliveryTimeDays);
    }
    if (input.tags !== undefined) {
      fields.push('tags');
      values.push(input.tags);
    }
    if (input.images !== undefined) {
      fields.push('images');
      values.push(input.images);
    }
    if (input.city !== undefined) {
      fields.push('city');
      values.push(input.city);
    }
    if (input.area !== undefined) {
      fields.push('area');
      values.push(input.area);
    }
    if (input.country !== undefined) {
      fields.push('country');
      values.push(input.country);
    }
    if (input.status !== undefined) {
      fields.push('status');
      values.push(input.status);
    }
    const placeholders = values.map((_, i) => `$${i + 1}`).join(', ');
    const { rows } = await this.db.query<ServiceDetailRow>(
      `INSERT INTO services (${fields.join(', ')}) VALUES (${placeholders}) RETURNING *`,
      values,
    );
    return rows[0]!;
  }

  async countServicesByProvider(providerId: string): Promise<number> {
    const { rows } = await this.db.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM services WHERE provider_id = $1`,
      [providerId],
    );
    return rows.length > 0 ? parseInt(rows[0]!.count, 10) : 0;
  }

  async listServicesByProvider(
    providerId: string,
    page: number,
    limit: number,
  ): Promise<{ rows: ServiceDetailRow[]; total: number }> {
    const total = await this.countServicesByProvider(providerId);
    const offset = (page - 1) * limit;
    const { rows } = await this.db.query<ServiceDetailRow>(
      `SELECT * FROM services WHERE provider_id = $1 ORDER BY created_at DESC LIMIT $2::int OFFSET $3::int`,
      [providerId, limit, offset],
    );
    return { rows, total };
  }

  async getServiceByIdAndProvider(
    serviceId: string,
    providerId: string,
  ): Promise<ServiceDetailRow | null> {
    const { rows } = await this.db.query<ServiceDetailRow>(
      `SELECT * FROM services WHERE id = $1 AND provider_id = $2`,
      [serviceId, providerId],
    );
    return rows[0] ?? null;
  }

  async updateService(
    serviceId: string,
    providerId: string,
    input: {
      title?: string;
      description?: string;
      categoryId?: string;
      price?: number;
      priceType?: string;
      isNegotiable?: boolean;
      currency?: string;
      deliveryTimeDays?: number;
      tags?: string[];
      images?: string[];
      city?: string;
      area?: string;
      country?: string;
      status?: string;
      rejectionReason?: string | null;
      reviewedBy?: string | null;
      reviewedAt?: Date | null;
    },
  ): Promise<ServiceDetailRow | null> {
    const entries = Object.entries(input).filter(([, v]) => v !== undefined);
    if (entries.length === 0) {
      return this.getServiceByIdAndProvider(serviceId, providerId);
    }
    const setClauses: string[] = [];
    const values: unknown[] = [];
    let idx = 1;
    const colMap: Record<string, string> = {
      title: 'title',
      description: 'description',
      categoryId: 'category_id',
      price: 'price',
      priceType: 'price_type',
      isNegotiable: 'is_negotiable',
      currency: 'currency',
      deliveryTimeDays: 'delivery_time_days',
      tags: 'tags',
      images: 'images',
      city: 'city',
      area: 'area',
      country: 'country',
      status: 'status',
      rejectionReason: 'rejection_reason',
      reviewedBy: 'reviewed_by',
      reviewedAt: 'reviewed_at',
    };
    for (const [key, value] of entries) {
      const col = colMap[key];
      if (col) {
        setClauses.push(`${col} = $${idx++}`);
        values.push(value);
      }
    }
    values.push(serviceId, providerId);
    const { rows } = await this.db.query<ServiceDetailRow>(
      `UPDATE services SET ${setClauses.join(', ')} WHERE id = $${idx++} AND provider_id = $${idx} RETURNING *`,
      values,
    );
    return rows[0] ?? null;
  }

  async updateServiceStatus(
    serviceId: string,
    providerId: string,
    newStatus: string,
  ): Promise<ServiceDetailRow | null> {
    const { rows } = await this.db.query<ServiceDetailRow>(
      `UPDATE services SET status = $1 WHERE id = $2 AND provider_id = $3 RETURNING *`,
      [newStatus, serviceId, providerId],
    );
    return rows[0] ?? null;
  }

  async deleteService(serviceId: string, providerId: string): Promise<boolean> {
    const { rowCount } = await this.db.query(
      `DELETE FROM services WHERE id = $1 AND provider_id = $2`,
      [serviceId, providerId],
    );
    return (rowCount ?? 0) > 0;
  }
}

export type { CategoryRow, ServiceSearchRow, ServiceDetailRow };
