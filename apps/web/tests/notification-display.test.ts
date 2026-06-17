import { describe, expect, it } from 'vitest';

import { getNotificationTargetHref } from '@/components/app/notification-display';

describe('notification target links', () => {
  it('keeps job and application IDs for exact job application deep links', () => {
    expect(
      getNotificationTargetHref('new_message', { jobId: 'job-1', applicationId: 'app-1' }, 'en'),
    ).toBe('/en/app/projects?job=job-1&application=app-1');
  });
});
