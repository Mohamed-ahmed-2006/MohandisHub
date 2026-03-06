// ---------------------------------------------------------------------------
// Services service — business logic for public service endpoints
// ---------------------------------------------------------------------------

import type { Service, ServiceCategory, ServiceSearchResult } from '@mohandishub/shared';

import { HttpError } from '../../utils/http-error.js';

import { ServicesRepository } from './services.repository.js';
import type { CategoryRow, ServiceDetailRow, ServiceSearchRow } from './services.repository.js';

export class ServicesService {
  constructor(private readonly repo: ServicesRepository = new ServicesRepository()) {}

  async listCategories(): Promise<ServiceCategory[]> {
    const rows = await this.repo.listActiveCategories();
    return rows.map((r) => this.toCategory(r));
  }

  async searchServices(
    filters: {
      categoryId?: string;
      city?: string;
      area?: string;
      providerType?: string;
      query?: string;
    },
    page: number = 1,
    limit: number = 20,
  ): Promise<{
    items: ServiceSearchResult[];
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  }> {
    const { rows, total } = await this.repo.searchServices(filters, page, limit);
    return {
      items: rows.map((r) => this.toSearchResult(r)),
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  async getServiceDetail(serviceId: string): Promise<Service> {
    const row = await this.repo.getServiceById(serviceId);
    if (!row) {
      throw new HttpError({
        statusCode: 404,
        code: 'SERVICE_NOT_FOUND',
        message: 'Service not found.',
      });
    }
    void this.repo.incrementViewCount(serviceId);
    return this.toService(row);
  }

  private toCategory(row: CategoryRow): ServiceCategory {
    return {
      id: row.id,
      nameEn: row.name_en,
      nameAr: row.name_ar,
      slug: row.slug,
      descriptionEn: row.description_en,
      descriptionAr: row.description_ar,
      icon: row.icon,
      parentId: row.parent_id,
      sortOrder: row.sort_order,
      isActive: row.is_active,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  private toSearchResult(row: ServiceSearchRow): ServiceSearchResult {
    return {
      id: row.id,
      title: row.title,
      providerId: row.provider_id,
      providerName: row.provider_name,
      providerRole: row.provider_role,
      providerAvatar: row.provider_avatar,
      categorySlug: row.category_slug,
      categoryNameEn: row.category_name_en,
      categoryNameAr: row.category_name_ar,
      price: row.price ? parseFloat(row.price) : null,
      priceType: row.price_type as ServiceSearchResult['priceType'],
      city: row.city,
      area: row.area,
      avgRating: row.avg_rating ? parseFloat(row.avg_rating) : null,
      isFeatured: row.is_featured,
    };
  }

  private toService(row: ServiceDetailRow): Service {
    return {
      id: row.id,
      providerId: row.provider_id,
      categoryId: row.category_id,
      title: row.title,
      description: row.description,
      price: row.price ? parseFloat(row.price) : null,
      priceType: row.price_type as Service['priceType'],
      currency: row.currency,
      deliveryTimeDays: row.delivery_time_days,
      status: row.status as Service['status'],
      rejectionReason: null,
      reviewedBy: null,
      reviewedAt: null,
      tags: row.tags ?? [],
      images: row.images ?? [],
      isFeatured: row.is_featured,
      viewCount: row.view_count,
      orderCount: row.order_count,
      avgRating: row.avg_rating ? parseFloat(row.avg_rating) : null,
      city: row.city,
      area: row.area,
      country: row.country,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
}
