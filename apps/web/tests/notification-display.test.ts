import { describe, expect, it } from 'vitest';

import { getNotificationTargetHref } from '@/components/app/notification-display';

describe('notification target links', () => {
  it('keeps job and application IDs for exact job application deep links', () => {
    expect(
      getNotificationTargetHref('new_message', { jobId: 'job-1', applicationId: 'app-1' }, 'en'),
    ).toBe('/en/app/projects?job=job-1&application=app-1');
  });

  it('routes award and bid-received notifications to need and bid context safely', () => {
    expect(
      getNotificationTargetHref(
        'need_bid_received',
        { needId: 'need-123', bidId: 'bid-456' },
        'en',
        'customer',
      ),
    ).toBe('/en/app?needId=need-123&bidId=bid-456');

    expect(
      getNotificationTargetHref(
        'need_bid_awarded',
        { needId: 'need-123', bidId: 'bid-456' },
        'ar',
        'expert',
      ),
    ).toBe('/ar/app?needId=need-123&bidId=bid-456');
  });

  it('safely handles missing payload IDs without generating malformed query strings', () => {
    expect(getNotificationTargetHref('need_bid_received', null, 'en')).toBe('/en/app');
    expect(getNotificationTargetHref('need_bid_awarded', {}, 'ar')).toBe('/ar/app');
  });

  it('routes customer and provider legacy wallet notifications to /app/history', () => {
    expect(
      getNotificationTargetHref('wallet_deposit_approved', null, 'en', 'customer'),
    ).toBe('/en/app/history');

    expect(
      getNotificationTargetHref('wallet_withdrawal_completed', null, 'ar', 'expert'),
    ).toBe('/ar/app/history');
  });

  it('routes MHC purchase notifications to /app/credits', () => {
    expect(
      getNotificationTargetHref('mhc_purchase_completed', null, 'en', 'expert'),
    ).toBe('/en/app/credits');

    expect(
      getNotificationTargetHref('mhc_purchase_failed', null, 'ar', 'business'),
    ).toBe('/ar/app/credits');
  });

  it('routes rejected-bid notification with IDs to need and bid context', () => {
    expect(
      getNotificationTargetHref(
        'need_bid_rejected',
        { needId: 'need-100', bidId: 'bid-200' },
        'en',
      ),
    ).toBe('/en/app?needId=need-100&bidId=bid-200');
  });

  it('routes rejected-bid notification without IDs safely to /app', () => {
    expect(getNotificationTargetHref('need_bid_rejected', null, 'en')).toBe('/en/app');
    expect(getNotificationTargetHref('need_bid_rejected', {}, 'ar')).toBe('/ar/app');
  });
});
