import { describe, expect, it, vi } from 'vitest';

import { CouponsService } from '../modules/coupons/coupons.service.js';
import {
  getNotificationCategory,
  isNotificationChannelRequired,
} from '../modules/notifications/notifications.service.js';

const activeCoupon = {
  id: '11111111-1111-4111-8111-111111111111',
  code: 'SAVE10',
  type: 'percent' as const,
  value: '10',
  currency: 'EGP',
  target_surface: 'service' as const,
  discount_target: 'service_price' as const,
  funding_source: 'platform' as const,
  provider_share_percent: null,
  platform_share_percent: null,
  min_spend: '100',
  max_discount: '50',
  max_uses: null,
  max_uses_per_user: 2,
  use_count: 0,
  allowed_roles: [],
  active: true,
  valid_from: new Date('2026-01-01T00:00:00Z'),
  valid_until: null,
  created_at: new Date('2026-01-01T00:00:00Z'),
  updated_at: new Date('2026-01-01T00:00:00Z'),
};

describe('product value logic', () => {
  it('keeps critical notification channels required', () => {
    expect(getNotificationCategory('reservation_disputed')).toBe('disputes');
    expect(isNotificationChannelRequired('reservation_completed', 'in_app')).toBe(true);
    expect(isNotificationChannelRequired('demo', 'in_app')).toBe(false);
  });

  it('requires coupon funding before activation', async () => {
    const service = new CouponsService({} as never);

    await expect(
      service.createAdmin({
        code: 'NOFUND',
        type: 'fixed',
        value: 10,
        currency: 'EGP',
        targetSurface: 'all',
        discountTarget: 'service_price',
        active: true,
        allowedRoles: [],
      }),
    ).rejects.toMatchObject({ code: 'COUPON_FUNDING_REQUIRED' });
  });

  it('selects the best valid coupon preview and applies caps', async () => {
    const repo = {
      findCandidates: vi.fn().mockResolvedValue([activeCoupon]),
      countUserRedemptions: vi.fn().mockResolvedValue(0),
    };
    const service = new CouponsService(repo as never);

    const preview = await service.preview(
      { surface: 'service', subtotal: 800, currency: 'EGP' },
      { id: 'user-1', role: 'customer' },
    );

    expect(preview.valid).toBe(true);
    expect(preview.discountAmount).toBe(50);
    expect(preview.finalAmount).toBe(750);
  });
});
