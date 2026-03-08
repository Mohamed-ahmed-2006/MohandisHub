// ---------------------------------------------------------------------------
// Services service — business logic for public service endpoints
// ---------------------------------------------------------------------------

import type { Service, ServiceCategory, ServiceSearchResult } from '@mohandishub/shared';

import { HttpError } from '../../utils/http-error.js';

import { ServicesRepository } from './services.repository.js';
import type { CategoryRow, ServiceDetailRow, ServiceSearchRow } from './services.repository.js';
import type { CreateServiceInput, UpdateServiceInput } from './services.validation.js';

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

  async createService(providerId: string, input: CreateServiceInput): Promise<Service> {
    const status = input.submitForReview ? 'pending_review' : 'draft';
    const dbInput: {
      title: string;
      description?: string;
      categoryId?: string;
      price?: number;
      priceType?: string;
      currency?: string;
      deliveryTimeDays?: number;
      tags?: string[];
      images?: string[];
      city?: string;
      area?: string;
      country?: string;
      status?: string;
    } = { title: input.title, status };
    if (input.description !== undefined) dbInput.description = input.description;
    if (input.categoryId !== undefined) dbInput.categoryId = input.categoryId;
    if (input.price !== undefined) dbInput.price = input.price;
    if (input.priceType !== undefined) dbInput.priceType = input.priceType;
    if (input.currency !== undefined) dbInput.currency = input.currency;
    if (input.deliveryTimeDays !== undefined) dbInput.deliveryTimeDays = input.deliveryTimeDays;
    if (input.tags !== undefined) dbInput.tags = input.tags;
    if (input.images !== undefined) dbInput.images = input.images;
    if (input.city !== undefined) dbInput.city = input.city;
    if (input.area !== undefined) dbInput.area = input.area;
    if (input.country !== undefined) dbInput.country = input.country;
    const row = await this.repo.createService(providerId, dbInput);
    return this.toService(row);
  }

  async listMyServices(
    providerId: string,
    page: number = 1,
    limit: number = 20,
  ): Promise<{ items: Service[]; total: number; page: number; limit: number; totalPages: number }> {
    const { rows, total } = await this.repo.listServicesByProvider(providerId, page, limit);
    return {
      items: rows.map((r) => this.toService(r)),
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  async updateService(
    serviceId: string,
    providerId: string,
    input: UpdateServiceInput,
  ): Promise<Service> {
    const row = await this.repo.getServiceByIdAndProvider(serviceId, providerId);
    if (!row) {
      throw new HttpError({
        statusCode: 404,
        code: 'SERVICE_NOT_FOUND',
        message: 'Service not found.',
      });
    }
    if (row.status !== 'draft' && row.status !== 'paused') {
      throw new HttpError({
        statusCode: 400,
        code: 'SERVICE_NOT_EDITABLE',
        message: 'Only draft or paused services can be edited.',
      });
    }
    const dbInput: {
      title?: string;
      description?: string;
      categoryId?: string;
      price?: number;
      priceType?: string;
      currency?: string;
      deliveryTimeDays?: number;
      tags?: string[];
      images?: string[];
      city?: string;
      area?: string;
      country?: string;
    } = {};
    if (input.title !== undefined) dbInput.title = input.title;
    if (input.description !== undefined) dbInput.description = input.description;
    if (input.categoryId !== undefined) dbInput.categoryId = input.categoryId;
    if (input.price !== undefined) dbInput.price = input.price;
    if (input.priceType !== undefined) dbInput.priceType = input.priceType;
    if (input.currency !== undefined) dbInput.currency = input.currency;
    if (input.deliveryTimeDays !== undefined) dbInput.deliveryTimeDays = input.deliveryTimeDays;
    if (input.tags !== undefined) dbInput.tags = input.tags;
    if (input.images !== undefined) dbInput.images = input.images;
    if (input.city !== undefined) dbInput.city = input.city;
    if (input.area !== undefined) dbInput.area = input.area;
    if (input.country !== undefined) dbInput.country = input.country;
    const updated = await this.repo.updateService(serviceId, providerId, dbInput);
    return this.toService(updated!);
  }

  async submitService(serviceId: string, providerId: string): Promise<Service> {
    const row = await this.repo.getServiceByIdAndProvider(serviceId, providerId);
    if (!row) {
      throw new HttpError({
        statusCode: 404,
        code: 'SERVICE_NOT_FOUND',
        message: 'Service not found.',
      });
    }
    if (row.status !== 'draft') {
      throw new HttpError({
        statusCode: 400,
        code: 'INVALID_STATUS',
        message: 'Only draft services can be submitted for review.',
      });
    }
    const updated = await this.repo.updateServiceStatus(serviceId, providerId, 'pending_review');
    return this.toService(updated!);
  }

  async pauseService(serviceId: string, providerId: string): Promise<Service> {
    const row = await this.repo.getServiceByIdAndProvider(serviceId, providerId);
    if (!row) {
      throw new HttpError({
        statusCode: 404,
        code: 'SERVICE_NOT_FOUND',
        message: 'Service not found.',
      });
    }
    if (row.status !== 'active') {
      throw new HttpError({
        statusCode: 400,
        code: 'INVALID_STATUS',
        message: 'Only active services can be paused.',
      });
    }
    const updated = await this.repo.updateServiceStatus(serviceId, providerId, 'paused');
    return this.toService(updated!);
  }

  async activateService(serviceId: string, providerId: string): Promise<Service> {
    const row = await this.repo.getServiceByIdAndProvider(serviceId, providerId);
    if (!row) {
      throw new HttpError({
        statusCode: 404,
        code: 'SERVICE_NOT_FOUND',
        message: 'Service not found.',
      });
    }
    if (row.status !== 'paused') {
      throw new HttpError({
        statusCode: 400,
        code: 'INVALID_STATUS',
        message: 'Only paused services can be activated.',
      });
    }
    const updated = await this.repo.updateServiceStatus(serviceId, providerId, 'active');
    return this.toService(updated!);
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
      rejectionReason: row.rejection_reason ?? null,
      reviewedBy: row.reviewed_by ?? null,
      reviewedAt: row.reviewed_at ?? null,
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
