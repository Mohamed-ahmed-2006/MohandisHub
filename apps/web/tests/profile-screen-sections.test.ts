import { describe, expect, it } from 'vitest';

import { getVisibleProfileSections } from '@/components/profile/profile-screen-sections';

describe('getVisibleProfileSections', () => {
  it('shows only account for customers', () => {
    expect(getVisibleProfileSections('customer').map((section) => section.id)).toEqual(['account']);
  });

  it('shows account, profile, and verification for experts', () => {
    expect(getVisibleProfileSections('expert').map((section) => section.id)).toEqual([
      'account',
      'profile',
      'verification',
    ]);
  });

  it('shows account, profile, and verification for businesses', () => {
    expect(getVisibleProfileSections('business').map((section) => section.id)).toEqual([
      'account',
      'profile',
      'verification',
    ]);
  });
});
