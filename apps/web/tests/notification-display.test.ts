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

  it('prevents customer role from being routed to provider-only /app/credits', () => {
    expect(
      getNotificationTargetHref('wallet_deposit_approved', null, 'en', 'customer'),
    ).toBe('/en/app/history');

    expect(
      getNotificationTargetHref('wallet_withdrawal_completed', null, 'ar', 'customer'),
    ).toBe('/ar/app/history');
  });

  it('routes provider roles to /app/credits for wallet notifications', () => {
    expect(
      getNotificationTargetHref('wallet_deposit_approved', null, 'en', 'expert'),
    ).toBe('/en/app/credits');

    expect(
      getNotificationTargetHref('wallet_withdrawal_completed', null, 'ar', 'business'),
    ).toBe('/ar/app/credits');
  });
});
