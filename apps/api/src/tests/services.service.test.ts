import { describe, expect, it, vi } from 'vitest';

import { ServicesService } from '../modules/services/services.service.js';

const makeServiceRow = (overrides: Record<string, unknown> = {}) => ({
  id: 'service-1',
  provider_id: 'provider-1',
  category_id: null,
  title: 'Structural Review',
  description: 'Detailed structural review service',
  price: '150',
  price_type: 'fixed',
  is_negotiable: false,
  currency: 'EGP',
  delivery_time_days: 5,
  status: 'draft',
  rejection_reason: null,
  reviewed_by: null,
  reviewed_at: null,
  tags: [],
  images: [],
  is_featured: false,
  view_count: 0,
  order_count: 0,
  avg_rating: null,
  city: 'Cairo',
  area: null,
  country: 'Egypt',
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
  ...overrides,
});

describe('ServicesService launch hardening', () => {
  it('hides non-active services from public detail and skips analytics increment', async () => {
    const repo = {
      getActiveServiceById: vi.fn().mockResolvedValue(null),
      incrementViewCount: vi.fn(),
    };
    const service = new ServicesService(repo as never, {} as never, {} as never);

    await expect(service.getServiceDetail('service-1')).rejects.toMatchObject({
      code: 'SERVICE_NOT_FOUND',
      statusCode: 404,
    });

    expect(repo.getActiveServiceById).toHaveBeenCalledWith('service-1');
    expect(repo.incrementViewCount).not.toHaveBeenCalled();
  });

  it('creates pending review services when submitForReview is requested', async () => {
    const repo = {
      createService: vi.fn().mockResolvedValue(makeServiceRow({ status: 'pending_review' })),
    };
    const settingsService = {
      getAppStatus: vi.fn().mockResolvedValue({ featurePlansEnabled: false }),
    };
    const plansService = {
      getEffectivePlanLimits: vi.fn(),
    };
    const service = new ServicesService(repo as never, plansService as never, settingsService as never);

    const result = await service.createService('provider-1', {
      title: 'Structural Review',
      submitForReview: true,
    });

    expect(repo.createService).toHaveBeenCalledWith(
      'provider-1',
      expect.objectContaining({
        title: 'Structural Review',
        status: 'pending_review',
      }),
    );
    expect(result.status).toBe('pending_review');
    expect(plansService.getEffectivePlanLimits).not.toHaveBeenCalled();
  });

  it('rejects invalid service status transition on submit', async () => {
    const repo = {
      getServiceByIdAndProvider: vi.fn().mockResolvedValue(makeServiceRow({ status: 'active' })),
      updateServiceStatus: vi.fn(),
    };
    const service = new ServicesService(repo as never, {} as never, {} as never);

    await expect(service.submitService('service-1', 'provider-1')).rejects.toMatchObject({
      code: 'INVALID_STATUS',
      statusCode: 400,
    });
    expect(repo.updateServiceStatus).not.toHaveBeenCalled();
  });
});
