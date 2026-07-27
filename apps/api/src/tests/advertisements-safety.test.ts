import { readFileSync } from 'node:fs';

import { describe, expect, it, vi } from 'vitest';

import {
  computeAdCancellationRefundPiastres,
  egpToPiastres,
} from '../modules/advertisements/advertisements.money.js';
import { AdvertisementsService } from '../modules/advertisements/advertisements.service.js';
import {
  createAdSchema,
  listAdsQuerySchema,
} from '../modules/advertisements/advertisements.validation.js';

const readSource = (relative: string): string =>
  readFileSync(new URL(relative, import.meta.url), 'utf8');

describe('advertising money and lifecycle safety', () => {
  it('quotes only exact integer-piastre values', () => {
    expect(egpToPiastres(12.34)).toBe(1234);
    expect(egpToPiastres(0)).toBe(0);
    expect(egpToPiastres(12.345)).toBeNull();
    expect(egpToPiastres(-1)).toBeNull();
    expect(egpToPiastres(Number.POSITIVE_INFINITY)).toBeNull();
  });

  it('refunds future campaigns fully and active campaigns pro rata without creating value', () => {
    const day = 24 * 60 * 60 * 1000;
    expect(
      computeAdCancellationRefundPiastres({
        totalPiastres: 7000,
        durationDays: 7,
        startsAtMs: 2 * day,
        expiresAtMs: 9 * day,
        effectiveNowMs: day,
      }),
    ).toBe(7000);
    expect(
      computeAdCancellationRefundPiastres({
        totalPiastres: 7000,
        durationDays: 7,
        startsAtMs: 0,
        expiresAtMs: 7 * day,
        effectiveNowMs: 2.5 * day,
      }),
    ).toBe(4500);
  });

  it('rejects user-controlled status, priority, unsupported destinations, and unsafe pagination', () => {
    const valid = {
      durationDays: 7,
      titleEn: 'Campaign',
      imageUrl: '/uploads/banner.webp',
      bannerUploadId: '9f5ed943-703e-4a83-bbe0-e5fb9f79583b',
      linkType: 'profile',
    };
    expect(createAdSchema.safeParse({ ...valid, status: 'active' }).success).toBe(false);
    expect(createAdSchema.safeParse({ ...valid, priority: 100 }).success).toBe(false);
    expect(createAdSchema.safeParse({ ...valid, linkType: 'need' }).success).toBe(false);
    expect(listAdsQuerySchema.safeParse({ page: '1e2', limit: '20' }).success).toBe(false);
    expect(listAdsQuerySchema.safeParse({ page: '1', limit: '101' }).success).toBe(false);
  });

  it('keeps delivery metrics token-authorized and viewability-gated', () => {
    const controller = readSource('../modules/advertisements/advertisements.controller.ts');
    const repository = readSource('../modules/advertisements/advertisements.repository.ts');
    const slideshow = readSource('../../../web/components/app/ad-slideshow.tsx');
    expect(controller).toContain('adDeliveryEventSchema');
    expect(repository).toContain("event_type = 'impression'");
    expect(repository).toContain("event_type = 'click'");
    expect(repository).toContain('impression_event_id');
    expect(repository).toContain("o.state = 'active'");
    expect(repository).toContain("s.status = 'active'");
    expect(slideshow).toContain('intersectionRatio >= 0.5');
    expect(slideshow).toContain('}, 1000)');
  });

  it('preserves the full paid duration across review and administrative scheduling', async () => {
    const repositorySource = readSource('../modules/advertisements/advertisements.repository.ts');
    const serviceSource = readSource('../modules/advertisements/advertisements.service.ts');
    expect(repositorySource).toContain('GREATEST(COALESCE(starts_at, now()), now())');
    expect(repositorySource).toContain("COALESCE(duration_days, 1) * interval '1 day'");
    expect(serviceSource).toContain('findWalletHoldByIdInTransaction');

    const repo = {
      getAdById: vi.fn().mockResolvedValue({
        id: 'ad-1',
        status: 'pending_review',
        duration_days: 7,
        starts_at: '2030-01-01T00:00:00.000Z',
      }),
      applyAdminSchedule: vi.fn((_id: string, input: unknown) => Promise.resolve(input)),
    };
    const service = new AdvertisementsService(repo as never, {} as never, {} as never);

    await expect(
      service.applyAdminSchedule('ad-1', {
        startsAt: '2030-02-01T00:00:00.000Z',
        expiresAt: '2030-02-03T00:00:00.000Z',
      }),
    ).rejects.toMatchObject({ code: 'AD_SCHEDULE_DURATION_MISMATCH' });

    await expect(
      service.applyAdminSchedule('ad-1', {
        startsAt: '2030-02-01T00:00:00.000Z',
        expiresAt: '2030-02-08T00:00:00.000Z',
      }),
    ).resolves.toMatchObject({
      startsAt: '2030-02-01T00:00:00.000Z',
      expiresAt: '2030-02-08T00:00:00.000Z',
    });
  });
});
