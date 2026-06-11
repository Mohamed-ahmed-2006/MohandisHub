// ---------------------------------------------------------------------------
// Services service — business logic for public service endpoints
// ---------------------------------------------------------------------------

import type {
  EffectivePlanLimits,
  Service,
  ServiceCategory,
  ServiceSearchResult,
  UserRole,
} from '@mohandishub/shared';

import { HttpError } from '../../utils/http-error.js';
import { PlansService } from '../plans/plans.service.js';
import { UsageQuotaService } from '../plans/usage-quota.service.js';
import { SettingsService } from '../settings/settings.service.js';

import { ServicesRepository } from './services.repository.js';
import type { CategoryRow, ServiceDetailRow, ServiceSearchRow } from './services.repository.js';
import type { CreateServiceInput, UpdateServiceInput } from './services.validation.js';

/** pg may return text[] as a JS array or as a Postgres literal like `{url1,url2}`. */
function safeStringArray(val: unknown): string[] {
  if (Array.isArray(val)) return val.filter((v): v is string => typeof v === 'string');
  if (typeof val === 'string' && val.startsWith('{') && val.endsWith('}')) {
    const inner = val.slice(1, -1);
    if (inner === '') return [];
    return inner.split(',').map((s) => s.replace(/^"|"$/g, ''));
  }
  return [];
}

export class ServicesService {
  constructor(
    private readonly repo: ServicesRepository = new ServicesRepository(),
    private readonly plansService: PlansService = new PlansService(),
    private readonly settingsService: SettingsService = new SettingsService(),
    private readonly usageQuotaService: UsageQuotaService = new UsageQuotaService(),
  ) {}

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
      minRating?: number;
      minPrice?: number;
      maxPrice?: number;
      verifiedOnly?: boolean;
      sort?: string;
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

  async getRecommendedServices(
    limit: number = 10,
    categoryId?: string,
  ): Promise<ServiceSearchResult[]> {
    const rows = await this.repo.getRecommendedServices(limit, categoryId);
    return rows.map((r) => this.toSearchResult(r));
  }

  async getServiceDetail(serviceId: string): Promise<Service> {
    const row = await this.repo.getActiveServiceById(serviceId);
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

  async createService(
    providerId: string,
    providerRole: UserRole,
    input: CreateServiceInput,
  ): Promise<Service> {
    const appStatus = await this.settingsService.getAppStatus();
    if (appStatus.featureHourlyPricingEnabled === false && input.priceType === 'hourly') {
      throw new HttpError({
        statusCode: 400,
        code: 'HOURLY_PRICING_DISABLED',
        message: 'Hourly pricing is disabled.',
      });
    }
    let planLimits: EffectivePlanLimits | null = null;
    if (appStatus.featurePlansEnabled) {
      planLimits = await this.plansService.getEffectivePlanLimits(providerId);
      const serviceCap =
        providerRole === 'business'
          ? (planLimits.maxBusinessServices ?? planLimits.maxServices)
          : planLimits.maxServices;
      if (serviceCap != null) {
        const count = await this.repo.countServicesByProvider(providerId);
        if (count >= serviceCap) {
          throw new HttpError({
            statusCode: 403,
            code: 'PLAN_LIMIT_REACHED',
            message: `Your plan allows up to ${serviceCap} services. Upgrade to add more.`,
          });
        }
      }
      const q = planLimits.usageQuotas.new_services_per_period;
      if (q) {
        const { start } = await this.usageQuotaService.resolvePeriodBounds(providerId, q.period);
        const used = await this.usageQuotaService.getCountForWindow(
          providerId,
          'new_services_per_period',
          start,
        );
        if (used >= q.maxPerPeriod) {
          throw new HttpError({
            statusCode: 403,
            code: 'PLAN_USAGE_QUOTA_EXCEEDED',
            message: `You have reached your plan limit for creating new services in this period (${q.maxPerPeriod} maximum).`,
          });
        }
      }
    }
    const status = input.submitForReview ? 'pending_review' : 'draft';
    const dbInput: {
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
    } = { title: input.title, status };
    if (input.description !== undefined) dbInput.description = input.description;
    if (input.categoryId !== undefined) dbInput.categoryId = input.categoryId;
    if (input.price !== undefined) dbInput.price = input.price;
    if (input.priceType !== undefined) dbInput.priceType = input.priceType;
    if (input.isNegotiable !== undefined) dbInput.isNegotiable = input.isNegotiable;
    if (input.currency !== undefined) dbInput.currency = input.currency;
    if (input.deliveryTimeDays !== undefined) dbInput.deliveryTimeDays = input.deliveryTimeDays;
    if (input.tags !== undefined) dbInput.tags = input.tags;
    if (input.images !== undefined) dbInput.images = input.images;
    if (input.city !== undefined) dbInput.city = input.city;
    if (input.area !== undefined) dbInput.area = input.area;
    if (input.country !== undefined) dbInput.country = input.country;
    const row = await this.repo.createService(providerId, dbInput);
    if (planLimits?.usageQuotas.new_services_per_period) {
      await this.usageQuotaService.consumeIfConfigured(
        providerId,
        'new_services_per_period',
        planLimits.usageQuotas.new_services_per_period,
      );
    }
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
    if (row.status === 'pending_review') {
      throw new HttpError({
        statusCode: 400,
        code: 'SERVICE_NOT_EDITABLE',
        message: 'Service is currently under review and cannot be edited.',
      });
    }
    const appStatus = await this.settingsService.getAppStatus();
    if (appStatus.featureHourlyPricingEnabled === false && input.priceType === 'hourly') {
      throw new HttpError({
        statusCode: 400,
        code: 'HOURLY_PRICING_DISABLED',
        message: 'Hourly pricing is disabled.',
      });
    }
    const dbInput: {
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
    } = {};
    if (input.title !== undefined) dbInput.title = input.title;
    if (input.description !== undefined) dbInput.description = input.description;
    if (input.categoryId !== undefined) dbInput.categoryId = input.categoryId;
    if (input.price !== undefined) dbInput.price = input.price;
    if (input.priceType !== undefined) dbInput.priceType = input.priceType;
    if (input.isNegotiable !== undefined) dbInput.isNegotiable = input.isNegotiable;
    if (input.currency !== undefined) dbInput.currency = input.currency;
    if (input.deliveryTimeDays !== undefined) dbInput.deliveryTimeDays = input.deliveryTimeDays;
    if (input.tags !== undefined) dbInput.tags = input.tags;
    if (input.images !== undefined) dbInput.images = input.images;
    if (input.city !== undefined) dbInput.city = input.city;
    if (input.area !== undefined) dbInput.area = input.area;
    if (input.country !== undefined) dbInput.country = input.country;
    if (row.status === 'active') {
      dbInput.status = 'pending_review';
      dbInput.rejectionReason = null;
      dbInput.reviewedBy = null;
      dbInput.reviewedAt = null;
    }
    const updated = await this.repo.updateService(serviceId, providerId, dbInput);
    return this.toService(updated!);
  }

  async deleteService(serviceId: string, providerId: string): Promise<{ deleted: boolean }> {
    const row = await this.repo.getServiceByIdAndProvider(serviceId, providerId);
    if (!row) {
      throw new HttpError({
        statusCode: 404,
        code: 'SERVICE_NOT_FOUND',
        message: 'Service not found.',
      });
    }
    const deleted = await this.repo.deleteService(serviceId, providerId);
    return { deleted };
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
    this.assertServiceStatusTransition(row.status, 'pending_review');
    const updated = await this.repo.updateServiceStatus(serviceId, providerId, 'pending_review');
    if (!updated) {
      throw new HttpError({
        statusCode: 404,
        code: 'SERVICE_NOT_FOUND',
        message: 'Service not found.',
      });
    }
    return this.toService(updated);
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
    this.assertServiceStatusTransition(row.status, 'paused');
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
    this.assertServiceStatusTransition(row.status, 'active');
    const updated = await this.repo.updateServiceStatus(serviceId, providerId, 'active');
    return this.toService(updated!);
  }

  private assertServiceStatusTransition(from: string, to: string): void {
    if (from === to) return;
    const allowed: Record<string, string[]> = {
      draft: ['pending_review'],
      pending_review: ['active', 'rejected'],
      active: ['paused', 'rejected'],
      paused: ['active'],
      rejected: ['pending_review'],
      archived: [],
    };
    if (!(allowed[from] ?? []).includes(to)) {
      throw new HttpError({
        statusCode: 400,
        code: 'INVALID_STATUS',
        message: `Cannot transition service status from ${from} to ${to}.`,
      });
    }
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
      providerVerified: Boolean(row.provider_verified),
      categorySlug: row.category_slug,
      categoryNameEn: row.category_name_en,
      categoryNameAr: row.category_name_ar,
      price: row.price ? parseFloat(row.price) : null,
      currency: row.currency ?? 'EGP',
      priceType: row.price_type as ServiceSearchResult['priceType'],
      isNegotiable: row.is_negotiable,
      city: row.city,
      area: row.area,
      avgRating: row.avg_rating ? parseFloat(row.avg_rating) : null,
      isFeatured: row.is_featured,
      images: safeStringArray(row.images),
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
      isNegotiable: row.is_negotiable,
      currency: row.currency,
      deliveryTimeDays: row.delivery_time_days,
      status: row.status as Service['status'],
      rejectionReason: row.rejection_reason ?? null,
      reviewedBy: row.reviewed_by ?? null,
      reviewedAt: row.reviewed_at ?? null,
      tags: Array.isArray(row.tags) ? row.tags : [],
      images: safeStringArray(row.images),
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
